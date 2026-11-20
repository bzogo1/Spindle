#!/usr/bin/env node
/**
 * Log retention enforcer for Spindle.
 *
 * Applies the retention policy in `scripts/retention/policy.json` (or
 * `--config <path>`) to files on disk: gzip files past `compressAfterDays`,
 * delete files past `deleteAfterDays`, and optionally protect the newest
 * `keepNewest` matches from deletion. Age is measured from file mtime, so
 * this is safe to run from cron against live log directories — it never
 * touches files younger than the configured thresholds.
 *
 * The policy is deliberately storage-agnostic: Docker's json-file driver
 * rotates container logs itself (see docs/observability/log-retention.md),
 * Loki/Vector enforce their own retention, and this script covers the files
 * that live on the host filesystem — app/shipper JSONL spools, nginx-style
 * access logs, deploy logs, the secret-access audit log, and backup
 * artifacts.
 *
 * Usage:
 *   node scripts/retention/enforce.mjs                 # apply policy.json
 *   node scripts/retention/enforce.mjs --dry-run       # print the plan, change nothing
 *   node scripts/retention/enforce.mjs --demo          # exercise the engine on a temp fixture tree
 *   node scripts/retention/enforce.mjs --config x.json --root /var/log/spindle --json
 *
 * Environment (RETENTION_* prefix, CLI flags win):
 *   RETENTION_CONFIG, RETENTION_ROOT, RETENTION_DRY_RUN
 */

import { Buffer } from "node:buffer"
import { createReadStream, createWriteStream } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"
import { env } from "node:process"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const defaultConfigPath = resolve(dirname(fileURLToPath(import.meta.url)), "policy.json")

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const HELP = `enforce.mjs — apply log retention policy (compress/delete by age)

Options:
  --config <path>   policy JSON file (default: scripts/retention/policy.json,
                    env RETENTION_CONFIG)
  --root <dir>      root that match patterns resolve against
                    (default: repo root, env RETENTION_ROOT)
  --dry-run         print planned actions, modify nothing (env RETENTION_DRY_RUN=1)
  --demo            build a fixture tree in a temp dir and run the engine on it
  --json            emit the action plan as JSON instead of a table
  --help            show this message

Policy file format (see scripts/retention/policy.json for the live policy):
  {
    "version": 1,
    "rules": [
      {
        "name": "app-logs",
        "match": ["logs/app/*.log*"],        // glob, relative to --root ('**' crosses dirs)
        "exclude": ["*.gz"],                  // optional glob exclusions
        "compressAfterDays": 7,               // gzip files older than this (optional)
        "deleteAfterDays": 30,                // delete files older than this (optional)
        "keepNewest": 0                       // newest N matches are never deleted (optional)
      }
    ]
  }

A rule needs at least one of compressAfterDays / deleteAfterDays.
Deletion is evaluated on the original (uncompressed) mtime and applies to
both plain and .gz files. Compressed output is "<file>.gz".
`

function parseArgs(argv) {
  const flags = new Set()
  const values = new Map()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (eq !== -1) {
      values.set(key, arg.slice(eq + 1))
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      values.set(key, argv[++i])
    } else {
      flags.add(key)
    }
  }

  return {
    flag: (name) => flags.has(name),
    value: (name, fallback) =>
      values.get(name) ?? env[`RETENTION_${name.toUpperCase().replaceAll("-", "_")}`] ?? fallback,
  }
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/** Convert a glob (`**`, `*`, `?`) to a RegExp matched against '/'-joined paths. */
function globToRegExp(glob) {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` also matches zero directories.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?"
          i += 2
        } else {
          out += ".*"
          i += 1
        }
      } else {
        out += "[^/]*"
      }
    } else if (ch === "?") {
      out += "[^/]"
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${out}$`)
}

/** Directory to start walking for a pattern: everything before the first glob char. */
function staticPrefixDir(pattern, root) {
  const magic = pattern.search(/[*?[]/)
  const prefix = magic === -1 ? pattern : pattern.slice(0, magic)
  const cut = prefix.lastIndexOf("/")
  const dirPart = cut === -1 ? "" : prefix.slice(0, cut)
  return resolve(root, dirPart || ".")
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "coverage",
  "dist",
  ".turbo",
  "storybook-static",
])

async function* walkFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

/** Resolve one glob pattern to absolute file paths under root. */
async function expandPattern(root, pattern) {
  const absPattern = pattern.startsWith("/") ? pattern : join(root, pattern)
  // Relative patterns match against the root-relative path; absolute patterns
  // match against the absolute path itself.
  const matchTarget = pattern.startsWith("/")
    ? absPattern.split(sep).join("/")
    : relative(root, absPattern).split(sep).join("/")
  const regex = globToRegExp(matchTarget)
  const startDir = staticPrefixDir(absPattern, root)

  // Exact path with no glob magic — skip the walk entirely.
  if (!/[*?[]/.test(pattern)) {
    try {
      const info = await stat(absPattern)
      if (info.isFile()) return [absPattern]
    } catch {
      // missing file — nothing to do
    }
    return []
  }

  const matches = new Set()
  for await (const file of walkFiles(startDir)) {
    const candidate = pattern.startsWith("/")
      ? file.split(sep).join("/")
      : relative(root, file).split(sep).join("/")
    if (regex.test(candidate)) matches.add(file)
  }
  return [...matches]
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

function validatePolicy(policy) {
  if (!policy || !Array.isArray(policy.rules)) {
    throw new Error("policy must be an object with a 'rules' array")
  }
  for (const [i, rule] of policy.rules.entries()) {
    if (!rule.name || typeof rule.name !== "string") {
      throw new Error(`rule #${i} is missing a string 'name'`)
    }
    if (!Array.isArray(rule.match) || rule.match.length === 0) {
      throw new Error(`rule '${rule.name}' needs a non-empty 'match' array`)
    }
    const hasAction =
      Number.isFinite(rule.compressAfterDays) || Number.isFinite(rule.deleteAfterDays)
    if (!hasAction) {
      throw new Error(`rule '${rule.name}' needs compressAfterDays and/or deleteAfterDays`)
    }
    for (const key of ["compressAfterDays", "deleteAfterDays", "keepNewest"]) {
      if (rule[key] !== undefined && (!Number.isFinite(rule[key]) || rule[key] < 0)) {
        throw new Error(`rule '${rule.name}': '${key}' must be a non-negative number`)
      }
    }
  }
}

/**
 * Build the action plan for one rule. Returns entries:
 *   { rule, file, action: 'compress'|'delete', ageDays, bytes, reason }
 */
async function planRule(root, rule, now) {
  const candidates = new Map() // absPath -> { rel, mtimeMs, size }

  for (const pattern of rule.match) {
    for (const file of await expandPattern(root, pattern)) {
      if (candidates.has(file)) continue
      const info = await stat(file)
      candidates.set(file, {
        rel: relative(root, file).split(sep).join("/"),
        mtimeMs: info.mtimeMs,
        size: info.size,
      })
    }
  }

  const excludeRes = (rule.exclude ?? []).map(globToRegExp)
  let files = [...candidates.entries()].filter(([, meta]) =>
    excludeRes.every((re) => !re.test(meta.rel) && !re.test(meta.rel.split("/").pop())),
  )

  // keepNewest protects the newest N files (by mtime) from deletion.
  const protectedPaths = new Set()
  if (rule.keepNewest > 0) {
    const byAge = [...files].sort((a, b) => b[1].mtimeMs - a[1].mtimeMs)
    for (const [file] of byAge.slice(0, rule.keepNewest)) protectedPaths.add(file)
  }

  const plan = []
  for (const [file, meta] of files) {
    const ageDays = (now - meta.mtimeMs) / DAY_MS
    const gzipped = file.endsWith(".gz")
    const protectedFromDelete = protectedPaths.has(file)

    if (!gzipped && Number.isFinite(rule.compressAfterDays) && ageDays >= rule.compressAfterDays) {
      plan.push({
        rule: rule.name,
        file,
        rel: meta.rel,
        action: "compress",
        ageDays,
        bytes: meta.size,
        reason: `age ${ageDays.toFixed(1)}d >= compressAfterDays ${rule.compressAfterDays}d`,
      })
      // A file being compressed this run is still subject to deletion only if
      // it is already past deleteAfterDays; report delete instead of compress.
      if (
        Number.isFinite(rule.deleteAfterDays) &&
        ageDays >= rule.deleteAfterDays &&
        !protectedFromDelete
      ) {
        plan[plan.length - 1].action = "delete"
        plan[plan.length - 1].reason =
          `age ${ageDays.toFixed(1)}d >= deleteAfterDays ${rule.deleteAfterDays}d (skips compress)`
      }
      continue
    }

    if (
      Number.isFinite(rule.deleteAfterDays) &&
      ageDays >= rule.deleteAfterDays &&
      !protectedFromDelete
    ) {
      plan.push({
        rule: rule.name,
        file,
        rel: meta.rel,
        action: "delete",
        ageDays,
        bytes: meta.size,
        reason: `age ${ageDays.toFixed(1)}d >= deleteAfterDays ${rule.deleteAfterDays}d`,
      })
    }
  }
  return plan
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function compressFile(file) {
  const tmpPath = `${file}.tmp-${process.pid}`
  const gzPath = `${file}.gz`
  try {
    // Preserve the source mtime on the archive so deleteAfterDays keeps
    // measuring age from the original log's last write, not the compress run.
    const before = await stat(file)
    await pipeline(createReadStream(file), createGzip(), createWriteStream(tmpPath))
    await rename(tmpPath, gzPath)
    await utimes(gzPath, before.atime, before.mtime)
    await unlink(file)
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}

async function applyPlan(plan, dryRun) {
  const results = []
  for (const item of plan) {
    if (dryRun) {
      results.push({ ...item, status: "planned" })
      continue
    }
    try {
      if (item.action === "compress") await compressFile(item.file)
      else await unlink(item.file)
      results.push({ ...item, status: "done" })
    } catch (error) {
      results.push({ ...item, status: "error", error: error.message })
    }
  }
  return results
}

function printReport(results, dryRun, json) {
  if (json) {
    console.log(JSON.stringify({ dryRun, actions: results }, null, 2))
    return
  }
  if (results.length === 0) {
    console.log(`[retention] no files matched the policy${dryRun ? " (dry-run)" : ""}`)
    return
  }
  const compress = results.filter((r) => r.action === "compress").length
  const del = results.filter((r) => r.action === "delete").length
  const bytes = results.reduce((sum, r) => sum + r.bytes, 0)
  console.log(
    `[retention] ${results.length} action(s): ${compress} compress, ${del} delete, ` +
      `${(bytes / 1024 / 1024).toFixed(1)} MiB touched${dryRun ? " (dry-run)" : ""}`,
  )
  for (const r of results) {
    const tag = r.status === "error" ? "ERROR" : dryRun ? "would" : "done "
    const verb = r.action === "compress" ? "gzip  " : "rm    "
    console.log(
      `  [${tag}] ${verb} ${r.rel}  (${r.reason}; ${r.status === "error" ? r.error : ""})`,
    )
  }
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

const DEMO_POLICY = {
  version: 1,
  rules: [
    {
      name: "secret-access-audit",
      match: [".spindle/secret-access-audit.jsonl*"],
      compressAfterDays: 30,
      deleteAfterDays: 365,
    },
    {
      name: "app-logs",
      match: ["logs/app/*.log*"],
      compressAfterDays: 7,
      deleteAfterDays: 30,
    },
    {
      name: "ship-spool",
      match: ["logs/ship/*.jsonl*", "logs/ship.jsonl*"],
      compressAfterDays: 7,
      deleteAfterDays: 30,
    },
    {
      name: "access-logs",
      match: ["logs/nginx/access.log*"],
      compressAfterDays: 7,
      deleteAfterDays: 90,
      keepNewest: 1,
    },
    {
      name: "backups",
      match: ["backups/spindle-*"],
      deleteAfterDays: 365,
      keepNewest: 2,
    },
  ],
}

/** Files: [relative path, ageDays, alreadyGzipped] */
const DEMO_FILES = [
  [".spindle/secret-access-audit.jsonl", 10, false], // kept: under compress threshold
  [".spindle/secret-access-audit.jsonl.1", 200, false], // compress (>30d, <365d)
  [".spindle/secret-access-audit.jsonl.2.gz", 800, true], // delete (>365d)
  ["logs/app/app-2026-01-01.log", 45, false], // delete (>30d)
  ["logs/app/app-today.log", 0.01, false], // kept
  ["logs/ship.jsonl.1", 20, false], // compress (>7d)
  ["logs/ship.jsonl", 1, false], // kept
  ["logs/nginx/access.log.1.gz", 120, true], // delete (>90d); keepNewest=1 only shields access.log
  ["logs/nginx/access.log.2.gz", 200, true], // delete
  ["logs/nginx/access.log", 0.5, false], // newest — protected by keepNewest
  ["backups/spindle-2025-01-01.dump", 410, false], // delete: 3rd newest, past keepNewest=2
  ["backups/spindle-2025-06-01.dump", 400, false], // kept: delete-eligible but inside keepNewest=2
  ["backups/spindle-2025-11-01.dump", 10, false], // newest — protected
  ["backups/README.txt", 400, false], // not matched by pattern
]

async function runDemo(dryRun, json) {
  const root = await mkdtemp(join(tmpdir(), "spindle-retention-demo-"))
  const configPath = join(root, "policy.demo.json")
  await writeFile(configPath, JSON.stringify(DEMO_POLICY, null, 2) + "\n")

  const now = Date.now()
  for (const [rel, ageDays, gz] of DEMO_FILES) {
    const path = join(root, rel)
    await mkdir(dirname(path), { recursive: true })
    const body = gz ? Buffer.from("1f8b0800000000000003", "hex") : `demo log line for ${rel}\n`
    await writeFile(path, body)
    const mtime = new Date(now - ageDays * DAY_MS)
    await utimes(path, mtime, mtime)
  }

  console.log(`[retention] demo workspace: ${root}`)
  const policy = JSON.parse(await readFile(configPath, "utf8"))
  validatePolicy(policy)

  const all = []
  for (const rule of policy.rules) {
    all.push(...(await planRule(root, rule, now)))
  }
  const results = await applyPlan(all, dryRun)
  printReport(results, dryRun, json)

  if (!dryRun) {
    console.log("[retention] resulting tree:")
    for await (const file of walkFiles(root)) {
      if (file.endsWith("policy.demo.json")) continue
      console.log(`  ${relative(root, file)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.flag("help")) {
    console.log(HELP)
    return
  }

  const dryRun =
    args.flag("dry-run") || env.RETENTION_DRY_RUN === "1" || env.RETENTION_DRY_RUN === "true"
  const json = args.flag("json")

  if (args.flag("demo")) {
    await runDemo(dryRun, json)
    return
  }

  const configPath = resolve(repoRoot, String(args.value("config", defaultConfigPath)))
  const root = resolve(repoRoot, String(args.value("root", env.RETENTION_ROOT ?? repoRoot)))

  let policy
  try {
    policy = JSON.parse(await readFile(configPath, "utf8"))
  } catch (error) {
    console.error(`[retention] cannot read policy ${configPath}: ${error.message}`)
    process.exitCode = 2
    return
  }

  try {
    validatePolicy(policy)
  } catch (error) {
    console.error(`[retention] invalid policy: ${error.message}`)
    process.exitCode = 2
    return
  }

  const now = Date.now()
  const all = []
  for (const rule of policy.rules) {
    all.push(...(await planRule(root, rule, now)))
  }
  const results = await applyPlan(all, dryRun)
  const errors = results.filter((r) => r.status === "error")
  printReport(results, dryRun, json)
  if (errors.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[retention] fatal: ${error.stack ?? error.message}`)
  process.exitCode = 1
})
