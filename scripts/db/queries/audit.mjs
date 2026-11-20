#!/usr/bin/env node
/**
 * Static Prisma query audit — no database connection required.
 *
 * Scans the repo for query-shaped patterns and reports findings:
 *   - raw SQL via $queryRaw/$executeRaw (and Unsafe variants)
 *   - unbounded list reads (findMany/count without take/cursor)
 *   - full-row fetches (findMany without select/include)
 *   - Prisma calls inside loops / async .map (N+1 candidates)
 *   - deleteMany/updateMany without a where clause
 *   - $transaction misuse (queries outside a transaction wrapper are fine;
 *     nested interactive transactions are not)
 *
 * Usage:
 *   node scripts/db/queries/audit.mjs                 # markdown report to stdout
 *   node scripts/db/queries/audit.mjs --format=json   # JSON report to stdout
 *   node scripts/db/queries/audit.mjs --out report.md # write markdown report
 *   node scripts/db/queries/audit.mjs --demo          # run against a built-in fixture
 *   node scripts/db/queries/audit.mjs --root <dir>    # scan a different root
 *
 * Exit code is 1 when findings of severity "error" exist (use --fail-on
 * warning|error|never to tune).
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

// This file embeds a demo fixture with prisma.* call sites; exclude itself
// so the fixture is not reported as a real finding.
const SELF = fileURLToPath(import.meta.url)

// Directories that never contain first-party query code.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "coverage",
  "dist",
  "legacy",
  "storybook-static",
  "test-results",
  "playwright-report",
  "playwright-report-visual",
  "playwright-report-storybook",
  ".email-preview",
  ".git",
])

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])

// Files that define queries legitimately (seed, migrations tooling) —
// raw SQL there is expected; still reported but downgraded to "info".
const SEED_OR_TOOLING = /(^|\/)(seed\.ts|migrate\.mjs)$|prisma\/migrations\//

const RAW_METHODS = {
  $queryRaw: "raw query",
  $queryRawUnsafe: "raw query (unsafe)",
  $executeRaw: "raw execute",
  $executeRawUnsafe: "raw execute (unsafe)",
}
const UNBOUNDED_METHODS = new Set(["findMany", "count", "aggregate", "groupBy"])
// createMany takes `data`, not `where` — it cannot be a whole-table write,
// so it is intentionally excluded from the no-where bulk-write rule.
const WRITE_MANY_METHODS = new Set(["deleteMany", "updateMany"])

function parseArgs(argv) {
  const args = {
    format: "md",
    root: REPO_ROOT,
    out: null,
    demo: false,
    failOn: "error",
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--format") args.format = argv[++i] ?? "md"
    else if (arg === "--root") args.root = path.resolve(argv[++i] ?? ".")
    else if (arg === "--out") args.out = argv[++i] ?? null
    else if (arg === "--demo") args.demo = true
    else if (arg === "--fail-on") args.failOn = argv[++i] ?? "error"
    else if (arg === "--help" || arg === "-h") args.help = true
    else if (arg.startsWith("--format=")) args.format = arg.slice("--format=".length)
    else if (arg.startsWith("--root=")) args.root = path.resolve(arg.slice("--root=".length))
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length)
    else if (arg.startsWith("--fail-on=")) args.failOn = arg.slice("--fail-on=".length)
    else {
      console.error(`audit: unknown argument ${arg}`)
      process.exit(2)
    }
  }
  return args
}

function* walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) yield* walk(full)
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      yield full
    }
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length
}

/**
 * Find the index of the bracket/brace matching the one at `openIndex`,
 * skipping string and template literals. Returns -1 when unbalanced.
 */
function matchBracket(text, openIndex, open = "{", close = "}") {
  let depth = 0
  let i = openIndex
  let state = "code" // code | sq | dq | tpl | lineComment | blockComment
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === "lineComment") {
      if (ch === "\n") state = "code"
    } else if (state === "blockComment") {
      if (ch === "*" && next === "/") {
        state = "code"
        i += 1
      }
    } else if (state === "sq" || state === "dq" || state === "tpl") {
      if (ch === "\\") i += 1
      else if (state === "sq" && ch === "'") state = "code"
      else if (state === "dq" && ch === '"') state = "code"
      else if (state === "tpl" && ch === "`") state = "code"
      else if (state === "tpl" && ch === "$" && next === "{") {
        // ${ ... } inside a template — scan it as code by recursing depth-wise
        const end = matchBracket(text, i + 1)
        if (end === -1) return -1
        i = end
      }
    } else {
      if (ch === "/" && next === "/") {
        state = "lineComment"
        i += 1
      } else if (ch === "/" && next === "*") {
        state = "blockComment"
        i += 1
      } else if (ch === "'") state = "sq"
      else if (ch === '"') state = "dq"
      else if (ch === "`") state = "tpl"
      else if (ch === open) depth += 1
      else if (ch === close) {
        depth -= 1
        if (depth === 0) return i
      }
    }
    i += 1
  }
  return -1
}

/** Return the argument object/array text for `prisma.x.y({ ... })` calls. */
function extractCallArg(text, callStart) {
  // Find the first ( or [ after the method name.
  let i = callStart
  while (i < text.length && text[i] !== "(" && text[i] !== "[") i += 1
  if (i >= text.length) return null
  const open = text[i]
  const close = open === "(" ? ")" : "]"
  const end = matchBracket(text, i, open, close)
  if (end === -1) return null
  return text.slice(i, end + 1)
}

const LOOP_START = /\b(for|for await|while)\s*\(|\.map\s*\(\s*async|\.forEach\s*\(\s*(?:async|\()/g
const DB_CALL =
  /\b(?:prisma|tx)\.\w+\.(?:find|create|update|delete|upsert|count|aggregate|groupBy)|\b(?:prisma|tx)\.\$(?:queryRaw|executeRaw|transaction)/

function hasKey(argText, key) {
  return new RegExp(`\\b${key}\\s*:`).test(argText ?? "")
}

function hasSpreadOrComputed(argText) {
  return /\.\.\.|\[\w+\]\s*:/.test(argText ?? "")
}

/** Scan a single source file; returns an array of findings. */
export function auditFile(filePath, source, { isTooling = false } = {}) {
  const findings = []
  const rel = filePath
  const add = (rule, severity, message, index, extra = {}) => {
    findings.push({
      file: rel,
      line: lineOf(source, index),
      rule,
      severity: isTooling && severity === "error" ? "warning" : severity,
      message,
      ...extra,
    })
  }

  // 1. Raw SQL
  for (const [method, label] of Object.entries(RAW_METHODS)) {
    const re = new RegExp(`\\b(?:prisma|tx)\\.${method.replace("$", "\\$")}\\s*\\(`, "g")
    let m
    while ((m = re.exec(source)) !== null) {
      const unsafe = method.endsWith("Unsafe")
      add(
        unsafe ? "raw-sql-unsafe" : "raw-sql",
        unsafe ? "error" : "warning",
        `${label} call — verify parameters use Prisma.sql tagged templates and review for injection.`,
        m.index,
        { method },
      )
    }
  }

  // 2. Model method calls: unbounded reads, full-row fetches, bulk writes
  const modelRe = /(?:^|[^\w$])(?:prisma|tx)\.([a-z][A-Za-z0-9]*)\.(\w+)\s*\(/g
  let m
  while ((m = modelRe.exec(source)) !== null) {
    const [, model, method] = m
    const argStart = m.index + m[0].length - 1 // at "("
    const argText = extractCallArg(source, argStart)
    const argIndex = argStart

    if (method === "$transaction") continue // handled below

    if (UNBOUNDED_METHODS.has(method) || method.startsWith("find")) {
      const bounded =
        argText &&
        (hasKey(argText, "take") || hasKey(argText, "cursor") || hasSpreadOrComputed(argText))
      if (UNBOUNDED_METHODS.has(method) && !bounded) {
        add(
          "unbounded-query",
          "warning",
          `${model}.${method} has no take/cursor — results are unbounded; add pagination or an explicit limit.`,
          argIndex,
          { model, method },
        )
      }
      if (
        (method === "findMany" ||
          method === "findFirst" ||
          method === "findUnique" ||
          method.endsWith("OrThrow")) &&
        argText &&
        !hasKey(argText, "select") &&
        !hasKey(argText, "include") &&
        !hasSpreadOrComputed(argText)
      ) {
        add(
          "no-select",
          "info",
          `${model}.${method} fetches every column — prefer select to narrow the payload.`,
          argIndex,
          { model, method },
        )
      }
    }

    if (WRITE_MANY_METHODS.has(method)) {
      if (argText && !hasKey(argText, "where") && !hasSpreadOrComputed(argText)) {
        add(
          "bulk-write-no-where",
          "error",
          `${model}.${method} without where updates/deletes every row.`,
          argIndex,
          { model, method },
        )
      }
    }
  }

  // 3. $transaction checks: nested interactive transactions
  const txRe = /\.transaction\s*\(\s*async\s*\(/g
  while ((m = txRe.exec(source)) !== null) {
    // Look for prisma.$transaction / .transaction( inside the callback window
    const window = source.slice(m.index, m.index + 4000)
    if (/\$transaction\s*\(/.test(window.slice(20))) {
      add(
        "nested-transaction",
        "warning",
        "Possible nested $transaction — avoid interactive transactions inside another transaction.",
        m.index,
      )
    }
  }

  // 4. N+1 candidates: DB calls inside loops or async .map
  const loopRe = new RegExp(LOOP_START.source, "g")
  while ((m = loopRe.exec(source)) !== null) {
    // Take a bounded window after the loop start as the loop body heuristic.
    const window = source.slice(m.index, m.index + 3000)
    if (DB_CALL.test(window)) {
      add(
        "possible-n-plus-one",
        "warning",
        "Database call inside a loop/async map — batch with findMany + where: { id: { in: ids } } or use include.",
        m.index,
      )
      break // one finding per file keeps the report readable
    }
  }

  return findings
}

/** Parse prisma/schema.prisma for model names (for report context). */
export function parseSchemaModels(schemaPath) {
  if (!fs.existsSync(schemaPath)) return []
  const text = fs.readFileSync(schemaPath, "utf8")
  const models = []
  for (const m of text.matchAll(/^\s*model\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const [, name, body] = m
    const indexes = [...body.matchAll(/@@index\(([^)]*)\)/g)].map((x) => x[1].trim())
    const uniques = [...body.matchAll(/@@unique\(([^)]*)\)/g)].map((x) => x[1].trim())
    models.push({ name, indexes, uniques })
  }
  return models
}

const DEMO_FIXTURE = [
  {
    file: "src/app/api/users/route.ts",
    source: `import { prisma } from "@/lib/db"

export async function GET() {
  return prisma.user.findMany()
}

export async function POST(req: Request) {
  const { ids } = await req.json()
  const users = []
  for (const id of ids) {
    users.push(await prisma.user.findUnique({ where: { id } }))
  }
  return Response.json(users)
}

export async function DELETE() {
  await prisma.user.deleteMany({})
  await prisma.$queryRawUnsafe("DELETE FROM users WHERE id = '" + req.id + "'")
}`,
  },
]

function runDemo() {
  const findings = []
  for (const { file, source } of DEMO_FIXTURE) {
    findings.push(...auditFile(file, source))
  }
  const schemaPath = path.join(REPO_ROOT, "prisma/schema.prisma")
  return {
    root: "(demo fixture)",
    findings,
    models: parseSchemaModels(schemaPath),
    scannedFiles: DEMO_FIXTURE.length,
  }
}

function runAudit(root) {
  const findings = []
  let scannedFiles = 0
  for (const file of walk(root)) {
    if (path.resolve(file) === SELF) continue
    const rel = path.relative(root, file)
    const isGenerated =
      rel.includes(`${path.sep}generated${path.sep}`) || rel.startsWith("src/generated")
    if (isGenerated) continue
    scannedFiles += 1
    let source
    try {
      source = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    // Cheap pre-filter: only files that mention a db-ish receiver.
    if (!/\b(?:prisma|tx)\s*\./.test(source) && !/\$queryRaw|\$executeRaw/.test(source)) continue
    const isTooling = SEED_OR_TOOLING.test(rel)
    findings.push(...auditFile(rel, source, { isTooling }))
  }
  const schemaPath = path.join(root, "prisma/schema.prisma")
  return { root, findings, models: parseSchemaModels(schemaPath), scannedFiles }
}

function summarize(findings) {
  const bySeverity = { info: 0, warning: 0, error: 0 }
  const byRule = {}
  for (const f of findings) {
    bySeverity[f.severity] += 1
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  }
  return { bySeverity, byRule }
}

function toMarkdown(report) {
  const { bySeverity, byRule } = summarize(report.findings)
  const lines = []
  lines.push("# Prisma query audit")
  lines.push("")
  lines.push(
    `Root: \`${report.root}\` · files scanned: ${report.scannedFiles} · findings: ${report.findings.length}`,
  )
  lines.push("")
  lines.push(`| severity | count |`)
  lines.push(`| --- | --- |`)
  for (const sev of ["error", "warning", "info"]) lines.push(`| ${sev} | ${bySeverity[sev]} |`)
  lines.push("")
  if (report.models.length) {
    lines.push("## Schema models")
    lines.push("")
    for (const model of report.models) {
      const idx = model.indexes.length ? ` · @@index: ${model.indexes.join(", ")}` : ""
      const uniq = model.uniques.length ? ` · @@unique: ${model.uniques.join(", ")}` : ""
      lines.push(`- \`${model.name}\`${idx}${uniq}`)
    }
    lines.push("")
  }
  if (Object.keys(byRule).length) {
    lines.push("## Findings by rule")
    lines.push("")
    lines.push("| rule | count |")
    lines.push("| --- | --- |")
    for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${rule} | ${count} |`)
    }
    lines.push("")
  }
  lines.push("## Findings")
  lines.push("")
  if (!report.findings.length) {
    lines.push("No findings — all scanned query sites look bounded and selected.")
    lines.push("")
    return lines.join("\n")
  }
  const order = { error: 0, warning: 1, info: 2 }
  const sorted = [...report.findings].sort(
    (a, b) =>
      order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line,
  )
  let lastFile = null
  for (const f of sorted) {
    if (f.file !== lastFile) {
      lines.push(`### ${f.file}`)
      lines.push("")
      lastFile = f.file
    }
    lines.push(`- **L${f.line}** [${f.severity}] \`${f.rule}\` — ${f.message}`)
  }
  lines.push("")
  return lines.join("\n")
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(
      "Usage: node scripts/db/queries/audit.mjs [--format json|md] [--out file] [--root dir] [--demo] [--fail-on error|warning|never]",
    )
    return 0
  }
  const report = args.demo ? runDemo() : runAudit(args.root)
  const { bySeverity } = summarize(report.findings)

  if (args.format === "json") {
    const out = JSON.stringify(
      { ...report, summary: { bySeverity, byRule: summarize(report.findings).byRule } },
      null,
      2,
    )
    if (args.out) {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
      fs.writeFileSync(args.out, `${out}\n`)
      console.log(`audit: wrote JSON report to ${args.out}`)
    } else {
      console.log(out)
    }
  } else {
    const md = toMarkdown(report)
    if (args.out) {
      fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
      fs.writeFileSync(args.out, md)
      console.log(`audit: wrote markdown report to ${args.out}`)
    } else {
      console.log(md)
    }
  }

  const shouldFail =
    args.failOn === "error"
      ? bySeverity.error > 0
      : args.failOn === "warning"
        ? bySeverity.error + bySeverity.warning > 0
        : args.failOn === "info"
          ? bySeverity.error + bySeverity.warning + bySeverity.info > 0
          : false
  return shouldFail ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
