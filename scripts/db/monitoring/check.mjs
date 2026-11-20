#!/usr/bin/env node
// Database monitoring alert checker for Spindle.
//
//   node scripts/db/monitoring/check.mjs [options]
//
// Evaluates the alert rules in scripts/db/monitoring/rules.json and prints a
// report. SQL rules connect to PostgreSQL via DATABASE_URL (env, .env.local,
// .env — same resolution order as scripts/db/migrate.mjs) using the `pg`
// driver. File rules (e.g. backup staleness) scan the filesystem and work
// without a database. `--dry-run` evaluates rules against the `demo` values
// in rules.json and never touches a database.
//
// Output: one `[monitor]`-prefixed line per rule plus a JSON summary, or pure
// JSON with --json. The report shape is generic-webhook friendly; see
// docs/runbooks/database-monitoring.md for piping to
// scripts/deploy/notify.ts or any webhook receiver.
//
// Exit codes: 0 all clear (or --dry-run), 1 at least one warning/critical/
// error result, 2 usage error.

/* eslint-disable no-restricted-properties --
   entrypoint script: it reads DATABASE_URL/MONITOR_* overrides before any app
   code loads, so src/lib/env.ts cannot be used here. */

import { readdir, stat, statfs } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenv } from "dotenv"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DEFAULT_RULES = join(ROOT, "scripts", "db", "monitoring", "rules.json")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/db/monitoring/check.mjs [options]

Options:
  --dry-run            evaluate rules against demo/sample data; never connect
  --json               print only the JSON report (default: text + summary)
  --ci                 machine-greppable [monitor] output
  --rules <path>       rules file (default: scripts/db/monitoring/rules.json)
  --only <id[,id...]>  evaluate only the named rule(s)
  --webhook <url>      POST the report to a webhook (env: MONITOR_WEBHOOK_URL)
  --help, -h           show this message

Environment:
  DATABASE_URL            Postgres connection string (env/.env.local/.env)
  MONITOR_BACKUP_DIR      backup dir for file rules (default: backups/)
  MONITOR_WEBHOOK_URL     webhook target (same as --webhook)
  MONITOR_WEBHOOK_TOKEN   bearer token for the webhook

Exit codes: 0 clear or dry-run, 1 warning/critical/error result, 2 usage error.`

function parseArgs(argv) {
  const options = { dryRun: false, json: false, ci: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--dry-run":
        options.dryRun = true
        break
      case "--json":
        options.json = true
        break
      case "--ci":
        options.ci = true
        break
      case "--rules":
        options.rules = next()
        break
      case "--only":
        options.only = next()
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case "--webhook":
        options.webhook = next()
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// Environment (same dotenv order as migrate.mjs / backup/lib.ts)
// ---------------------------------------------------------------------------

loadDotenv({ path: [join(ROOT, ".env.local"), join(ROOT, ".env")], quiet: true })

const databaseUrl = process.env.DATABASE_URL
const monitorWebhookUrl = process.env.MONITOR_WEBHOOK_URL
const monitorWebhookToken = process.env.MONITOR_WEBHOOK_TOKEN

// ---------------------------------------------------------------------------
// Rules loading
// ---------------------------------------------------------------------------

function loadRules(path) {
  const resolved = resolve(ROOT, path)
  if (!existsSync(resolved)) {
    throw new Error(`rules file not found: ${resolved}`)
  }
  const parsed = JSON.parse(readFileSync(resolved, "utf8"))
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error(`rules file ${resolved} has no rules`)
  }
  return parsed.rules
}

// ---------------------------------------------------------------------------
// Evaluation primitives
// ---------------------------------------------------------------------------

function compare(value, op, threshold) {
  switch (op ?? ">") {
    case ">":
      return value > threshold
    case ">=":
      return value >= threshold
    case "<":
      return value < threshold
    case "<=":
      return value <= threshold
    case "==":
    case "===":
      return value === threshold
    case "!=":
      return value !== threshold
    default:
      throw new Error(`unsupported operator: ${op}`)
  }
}

function toNumber(value) {
  if (value === null || value === undefined) return null
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "n/a"
  if (unit === "fraction") return `${(value * 100).toFixed(1)}%`
  if (unit === "seconds") return `${Math.round(value)}s`
  if (unit === "hours") return `${value.toFixed(1)}h`
  return String(value)
}

function interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  )
}

/**
 * Measures a single rule. Returns { value, unit, details, demo } or throws.
 * A `null` value means "could not measure" and maps to status 'skipped'.
 */
async function measure(rule, ctx) {
  if (ctx.dryRun && rule.demo !== undefined) {
    return { value: rule.demo, demo: true, details: `demo value ${rule.demo}` }
  }

  switch (rule.type) {
    case "sql": {
      if (!ctx.db) return { value: null, details: ctx.dbSkipReason }
      const result = await ctx.db.query(rule.query)
      const row = result.rows[0]
      if (!row) return { value: null, details: "query returned no rows" }
      return { value: toNumber(Object.values(row)[0]), details: rule.query }
    }

    case "sql-path": {
      if (!ctx.db) return { value: null, details: ctx.dbSkipReason }
      const result = await ctx.db.query(rule.query)
      const row = result.rows[0]
      const path = row ? Object.values(row)[0] : null
      if (typeof path !== "string" || path === "") {
        return { value: null, details: "query returned no path" }
      }
      try {
        const stats = await statfs(path)
        if (!stats.blocks || stats.blocks === 0) {
          return { value: null, details: `statfs(${path}) reported no blocks` }
        }
        const used = 1 - stats.bavail / stats.blocks
        return {
          value: used,
          details: `statfs(${path}): ${((1 - stats.bavail / stats.blocks) * 100).toFixed(1)}% used`,
        }
      } catch (error) {
        return {
          value: null,
          details: `cannot statfs ${path} locally (remote DB host?): ${error.message}`,
        }
      }
    }

    case "file": {
      const dir = resolve(ROOT, process.env[rule.pathEnv ?? ""] ?? rule.pathDefault ?? "backups")
      if (!existsSync(dir)) {
        return { value: null, missing: true, details: `directory not found: ${dir}` }
      }
      const pattern = rule.pattern ? new RegExp(rule.pattern) : null
      const entries = await readdir(dir, { withFileTypes: true })
      const files = []
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith(".")) continue
        if (pattern && !pattern.test(entry.name)) continue
        files.push(join(dir, entry.name))
      }
      if (files.length === 0) {
        return { value: null, empty: true, details: `no matching files in ${dir}` }
      }
      const metric = rule.metric ?? "newestAgeHours"
      if (metric === "newestAgeHours" || metric === "oldestAgeHours") {
        const times = await Promise.all(files.map(async (f) => (await stat(f)).mtimeMs))
        const extreme = metric === "newestAgeHours" ? Math.max(...times) : Math.min(...times)
        const ageHours = (ctx.now - extreme) / 3_600_000
        const newest = metric === "newestAgeHours"
        const file = files[times.indexOf(extreme)]
        return {
          value: ageHours,
          details: `${newest ? "newest" : "oldest"} backup: ${file} (${ageHours.toFixed(1)}h old)`,
        }
      }
      if (metric === "fileCount") {
        return { value: files.length, details: `${files.length} matching file(s) in ${dir}` }
      }
      return { value: null, details: `unknown file metric: ${metric}` }
    }

    default:
      throw new Error(`unknown rule type: ${rule.type}`)
  }
}

async function evaluateRule(rule, ctx) {
  const result = {
    id: rule.id,
    title: rule.title,
    severity: rule.severity ?? "warning",
    unit: rule.unit,
    runbook: rule.runbook,
    thresholds: { warn: rule.warn, critical: rule.critical, op: rule.op ?? ">" },
  }

  let measured
  try {
    measured = await measure(rule, ctx)
  } catch (error) {
    return {
      ...result,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const { value } = measured
  const vars = {
    value: formatValue(value, rule.unit),
    warn: formatValue(rule.warn, rule.unit),
    critical: formatValue(rule.critical, rule.unit),
    ...Object.fromEntries(
      Object.entries(measured.detailsVars ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  }
  const message = rule.message
    ? interpolate(rule.message, vars)
    : value !== null && value !== undefined
      ? `${formatValue(value, rule.unit)} (warn ${vars.warn ?? "-"}, critical ${vars.critical ?? "-"})`
      : (measured.details ?? "")

  if (measured.missing) {
    return { ...result, status: "skipped", value: null, message }
  }
  if (measured.empty) {
    if (rule.whenEmpty === "critical") {
      return {
        ...result,
        status: "critical",
        value: null,
        message: `no backup files found — ${message}`,
      }
    }
    return { ...result, status: "skipped", value: null, message }
  }
  if (value === null || value === undefined) {
    return { ...result, status: "skipped", value: null, message }
  }

  const op = rule.op ?? ">"
  let status = "ok"
  if (rule.critical !== undefined && compare(value, op, rule.critical)) {
    status = "critical"
  } else if (rule.warn !== undefined && compare(value, op, rule.warn)) {
    status = "warning"
  }

  return {
    ...result,
    status,
    value,
    demo: measured.demo || undefined,
    message: message || undefined,
    details: measured.details,
  }
}

// ---------------------------------------------------------------------------
// Database connection (real runs only)
// ---------------------------------------------------------------------------

async function connectDb(rules) {
  const needsDb = rules.some((r) => r.requiresDb === true)
  if (!needsDb) return { db: null, skipReason: "no database rules" }
  if (!databaseUrl) {
    return {
      db: null,
      skipReason: "DATABASE_URL is not set",
      fatal: true,
    }
  }
  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
  } catch (error) {
    // Node surfaces multi-address failures as AggregateError with an empty
    // message; prefer the first inner error's message/code.
    const inner =
      error instanceof AggregateError && error.errors.length > 0 ? error.errors[0] : error
    const detail =
      inner instanceof Error ? inner.message || inner.code || inner.name : String(inner)
    return {
      db: null,
      skipReason: `could not connect: ${detail}`,
      fatal: true,
    }
  }
  return { db: client, skipReason: null }
}

function redactUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.password = ""
    parsed.username = parsed.username ? "***" : ""
    return parsed.toString()
  } catch {
    return "[unparseable]"
  }
}

// ---------------------------------------------------------------------------
// Webhook delivery (generic JSON POST; optional bearer token)
// ---------------------------------------------------------------------------

async function postWebhook(url, payload, token) {
  const headers = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    // eslint-disable-next-line no-undef -- AbortSignal.timeout is Node 17.3+; not in eslint browser globals
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`webhook POST failed: ${response.status} ${detail.slice(0, 300)}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const rulesPath = options.rules ?? DEFAULT_RULES
  let allRules
  try {
    allRules = loadRules(rulesPath)
  } catch (error) {
    console.error(`[monitor] ${error instanceof Error ? error.message : error}`)
    return 2
  }

  const rules = options.only?.length
    ? allRules.filter((r) => options.only.includes(r.id))
    : allRules
  const unknown = (options.only ?? []).filter((id) => !allRules.some((r) => r.id === id))
  for (const id of unknown) {
    console.error(`[monitor] unknown rule id: ${id}`)
  }
  if (rules.length === 0) return 2

  const ctx = { dryRun: options.dryRun, now: Date.now(), db: null, dbSkipReason: null }

  if (!options.dryRun) {
    const connection = await connectDb(rules)
    ctx.db = connection.db
    ctx.dbSkipReason = connection.skipReason
    if (connection.skipReason && connection.fatal) {
      // DB unreachable: every DB-backed rule reports 'error' via measure().
      ctx.dbSkipReason = `database unavailable: ${connection.skipReason}`
      ctx.dbError = true
    }
  } else {
    ctx.dbSkipReason = "dry-run: database not queried"
  }

  // When the DB is unreachable, surface each SQL rule as 'error' rather than
  // silently 'skipped' — a monitoring run that cannot see the DB is itself a
  // failure signal.
  if (ctx.dbError) {
    for (const rule of rules) {
      if (rule.type.startsWith("sql") && rule.requiresDb === true) {
        rule.__dbError = ctx.dbSkipReason
      }
    }
  }

  const results = []
  for (const rule of rules) {
    const result = await evaluateRule(rule, ctx)
    if (rule.__dbError && result.status === "skipped") {
      result.status = "error"
      result.message = rule.__dbError
    }
    results.push(result)
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    },
    { ok: 0, warning: 0, critical: 0, skipped: 0, error: 0 },
  )

  const report = {
    type: "database-monitoring",
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    rulesFile: rulesPath,
    database: options.dryRun
      ? { mode: "dry-run" }
      : databaseUrl
        ? { connected: Boolean(ctx.db), url: redactUrl(databaseUrl) }
        : { connected: false, url: null },
    summary,
    alerts: results,
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const pad = (s) => s.padEnd(8)
    for (const r of results) {
      const value =
        r.value === null || r.value === undefined ? "" : ` value=${formatValue(r.value, r.unit)}`
      const demo = r.demo ? " [demo]" : ""
      console.log(
        options.ci
          ? `[monitor] ${r.status}: ${r.id}${value}${demo}${r.message ? ` — ${r.message}` : ""}`
          : `${pad(r.status.toUpperCase())} ${r.id}${value}${demo}${r.message ? ` — ${r.message}` : ""}`,
      )
    }
    console.log(
      `[monitor] summary: ${
        Object.entries(summary)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}=${n}`)
          .join(" ") || "no results"
      }`,
    )
  }

  // Webhook delivery — skipped in dry-run and json-pipe mode unless explicit.
  const webhookUrl = options.webhook ?? monitorWebhookUrl
  if (webhookUrl && !options.dryRun) {
    try {
      await postWebhook(webhookUrl, report, monitorWebhookToken)
      console.error(`[monitor] report posted to webhook`)
    } catch (error) {
      console.error(`[monitor] webhook delivery failed: ${error.message}`)
      return 1
    }
  } else if (webhookUrl && options.dryRun) {
    console.error(`[monitor] dry-run: would POST report to ${webhookUrl}`)
  }

  if (ctx.db) await ctx.db.end().catch(() => {})

  if (options.dryRun) return 0
  const firing = results.filter((r) => ["warning", "critical", "error"].includes(r.status))
  return firing.length > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[monitor] unexpected error: ${error?.stack ?? error}`)
    process.exit(2)
  })
