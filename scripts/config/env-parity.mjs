/**
 * Environment parity checker.
 *
 * Compares the environment-variable contract across the places it is
 * declared:
 *
 *   - `.env.example`            — the documented contract (key names only;
 *                                 values are never read or printed)
 *   - `src/lib/env-schema.ts`   — client zod schema
 *   - `src/lib/env.server.ts`   — server/build zod schemas, expectation
 *                                 messages, and `configuredEnvKeys` (the
 *                                 "must stay documented" list)
 *   - `src/lib/env.ts`          — hand-rolled client parser and expectations
 *   - `.env*` files in the root — per-environment overrides; only KEY
 *                                 presence is compared, never values
 *   - `src/**`                  — stray `process.env.X` reads outside the
 *                                 env modules (reported as warnings)
 *
 * Checks:
 *   (a) contract parity — every schema/configured key is documented in
 *       `.env.example`, and every `.env.example` key is referenced by the
 *       contract (orphans are flagged);
 *   (b) env-file key parity — `.env.local`, `.env.production`, etc. carry
 *       no keys unknown to `.env.example`;
 *   (c) `NEXT_PUBLIC_*` prefixing — client-exposed keys are prefixed, and
 *       every `NEXT_PUBLIC_*` contract key is declared in the client schema
 *       so Next.js actually inlines it;
 *   (d) modes — `--ci` exits non-zero on errors AND warnings for CI gating,
 *       `--demo` runs against a built-in fixture, `--dry-run` skips writing
 *       report files, `--report-dir <dir>` writes the markdown + JSON
 *       report.
 *
 * Usage:
 *   node scripts/config/env-parity.mjs [--ci] [--demo] [--dry-run]
 *       [--json] [--report-dir <dir>]
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

// Variables that legitimately never appear in .env.example: they are injected
// by the platform (Next.js, Vercel, GitHub Actions) or are local tooling
// flags. Everything else in the schema contract must be documented.
const UNDOCUMENTED_OK = new Set([
  "NODE_ENV", // set by Next.js / the process manager
  "NEXT_RUNTIME", // injected by Next.js per-request
  "CI", // set by CI providers and local tooling
  "ANALYZE", // `npm run analyze` toggle, never a runtime setting
])

// Client-exposed keys that are not NEXT_PUBLIC_* by design: NODE_ENV is
// inlined by Next.js itself.
const CLIENT_PREFIX_EXEMPT = new Set(["NODE_ENV"])

const ENV_FILE_CANDIDATES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
]

const SRC_ENV_MODULES = new Set([
  "src/lib/env.ts",
  "src/lib/env.server.ts",
  "src/lib/env-schema.ts",
])

const ENV_KEY_RE = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/
const PROCESS_ENV_RE =
  /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["'`]([A-Z][A-Z0-9_]*)["'`]\]/g
const OBJECT_KEY_RE = /^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*:/gm
const QUOTED_KEY_RE = /["']([A-Z][A-Z0-9_]*)["']/g
const NEXT_PUBLIC_RE = /^NEXT_PUBLIC_/

// ---------------------------------------------------------------------------
// Source parsing helpers — deliberately regex/brace based so the checker has
// no dependency on the TypeScript toolchain and runs on plain `node`.
// ---------------------------------------------------------------------------

/**
 * Returns the `{ ... }` or `[ ... ]` container on the right-hand side of the
 * first `marker = ...` assignment. Locating the `=` first avoids matching
 * brackets inside type annotations such as `readonly string[]`.
 */
function extractBlock(source, marker) {
  const start = source.indexOf(marker)
  if (start === -1) return null
  const eq = source.indexOf("=", start)
  if (eq === -1) return null
  const openBrace = source.indexOf("{", eq)
  const openBracket = source.indexOf("[", eq)
  let open
  let close
  if (openBrace === -1 && openBracket === -1) return null
  if (openBrace === -1 || (openBracket !== -1 && openBracket < openBrace)) {
    open = openBracket
    close = "]"
  } else {
    open = openBrace
    close = "}"
  }
  const opener = source[open]
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === opener) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

/** Keys of a `z.object({ KEY: ... })` or expectation record block. */
function objectKeys(block) {
  if (block === null) return new Set()
  const keys = new Set()
  for (const match of block.matchAll(OBJECT_KEY_RE)) keys.add(match[1])
  return keys
}

/** String entries of an array-of-strings block (`configuredEnvKeys`). */
function quotedKeys(block) {
  if (block === null) return new Set()
  const keys = new Set()
  for (const match of block.matchAll(QUOTED_KEY_RE)) keys.add(match[1])
  return keys
}

/** KEY names (never values) declared in a dotenv-style file's text. */
function parseDotenvKeys(text) {
  const keys = new Set()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = trimmed.match(ENV_KEY_RE)
    if (match) keys.add(match[1])
  }
  return keys
}

/**
 * Removes comments well enough for env-key scanning: block comments fully,
 * and `//` line comments only when the slashes are preceded by whitespace or
 * line start (so `https://` inside string literals survives). This is a
 * heuristic — it can rarely hide a same-line `process.env` read after a
 * `//` inside a string, which is acceptable for a parity check.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/gm, "$1")
}

/** Every `process.env.X` / `process.env["X"]` read in a source file. */
function processEnvRefs(source) {
  const keys = new Set()
  for (const match of stripComments(source).matchAll(PROCESS_ENV_RE)) {
    const key = match[1] ?? match[2]
    // Skip partial dynamic reads like `process.env.NEXT_PUBLIC_` in comments.
    if (key && /[A-Z0-9]$/.test(key)) keys.add(key)
  }
  return keys
}

function* walkSrc(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "generated") continue
      yield* walkSrc(full)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name)) {
      yield full
    }
  }
}

// ---------------------------------------------------------------------------
// Contract extraction
// ---------------------------------------------------------------------------

/**
 * Reads the env contract out of the env modules. Returns a map of
 * section name -> Set(keys), plus the flat union.
 */
function extractContract({ envTs, envServerTs, envSchemaTs }) {
  const sections = {}

  sections.clientSchema = objectKeys(extractBlock(envSchemaTs, "clientSchema = z.object("))
  sections.serverSchema = objectKeys(extractBlock(envServerTs, "serverSchema = z.object("))
  sections.buildSchema = objectKeys(extractBlock(envServerTs, "buildSchema = z.object("))
  sections.clientExpectations = objectKeys(extractBlock(envTs, "clientExpectations"))
  // `clientExpectations` in env.ts is a Record literal; `extractBlock` finds
  // its first `{`, which is the object literal — same for the server records.
  sections.serverExpectations = objectKeys(extractBlock(envServerTs, "serverExpectations"))
  sections.buildExpectations = objectKeys(extractBlock(envServerTs, "buildExpectations"))
  sections.configuredEnvKeys = quotedKeys(extractBlock(envServerTs, "configuredEnvKeys"))
  // rawClientEnv is `const rawClientEnv: EnvSource = { ... }` — extractBlock
  // keyed on the const name still lands on the object literal.
  sections.rawClientEnv = objectKeys(extractBlock(envTs, "rawClientEnv"))

  const all = new Set()
  for (const keys of Object.values(sections)) for (const key of keys) all.add(key)
  sections.__all = all
  return sections
}

// ---------------------------------------------------------------------------
// Checks — pure functions over collected inputs so --demo can reuse them.
// ---------------------------------------------------------------------------

function finding(severity, check, message, extra = {}) {
  return { severity, check, message, ...extra }
}

/**
 * @param {object} input
 * @param {Map<string, Set<string>>} input.envFiles  filename -> key set
 * @param {Set<string>} input.srcEnvRefs            process.env keys found in src/**
 */
function runChecks({ sections, exampleKeys, envFiles, srcEnvRefs }) {
  const findings = []
  const all = sections.__all
  const clientKeys = new Set([
    ...sections.clientSchema,
    ...sections.clientExpectations,
    ...sections.rawClientEnv,
  ])
  const configured = sections.configuredEnvKeys

  // (a) Contract <-> .env.example parity -------------------------------

  for (const key of configured) {
    if (!exampleKeys.has(key)) {
      findings.push(
        finding(
          "error",
          "contract",
          `configuredEnvKeys entry "${key}" is missing from .env.example — the documentation contract is incomplete.`,
          { key },
        ),
      )
    }
  }

  for (const key of all) {
    if (UNDOCUMENTED_OK.has(key)) continue
    if (!configured.has(key)) {
      findings.push(
        finding(
          "error",
          "contract",
          `"${key}" is declared in the env schema/expectations but missing from configuredEnvKeys in src/lib/env.server.ts, so it is not guaranteed to stay documented in .env.example.`,
          { key },
        ),
      )
    }
  }

  for (const key of exampleKeys) {
    if (!all.has(key) && !UNDOCUMENTED_OK.has(key)) {
      findings.push(
        finding(
          "error",
          "contract",
          `"${key}" is documented in .env.example but not referenced by any env schema, expectation list, or configuredEnvKeys — orphaned contract entry.`,
          { key },
        ),
      )
    }
  }

  // (b) Per-environment file key parity ---------------------------------

  for (const [file, keys] of envFiles) {
    for (const key of keys) {
      if (!exampleKeys.has(key)) {
        findings.push(
          finding(
            "warning",
            "env-file",
            `${file} sets "${key}", which is not documented in .env.example. Add it to the contract or remove it. (key name only — value not inspected)`,
            { key, file },
          ),
        )
      }
    }
  }

  // (c) NEXT_PUBLIC_* prefixing ------------------------------------------

  for (const key of clientKeys) {
    if (!NEXT_PUBLIC_RE.test(key) && !CLIENT_PREFIX_EXEMPT.has(key)) {
      findings.push(
        finding(
          "error",
          "public-prefix",
          `"${key}" is exposed through the client env contract without the NEXT_PUBLIC_ prefix — Next.js will not inline it into the browser bundle.`,
          { key },
        ),
      )
    }
  }

  for (const key of sections.serverSchema) {
    if (NEXT_PUBLIC_RE.test(key)) {
      findings.push(
        finding(
          "warning",
          "public-prefix",
          `"${key}" is a NEXT_PUBLIC_* key declared in the server schema. Harmless, but verify it is also in clientSchema so the browser sees the same value.`,
          { key },
        ),
      )
    }
  }

  for (const key of exampleKeys) {
    if (NEXT_PUBLIC_RE.test(key) && !clientKeys.has(key)) {
      findings.push(
        finding(
          "error",
          "public-prefix",
          `"${key}" is a NEXT_PUBLIC_* key in .env.example but is not declared in the client schema — it will never reach the browser.`,
          { key },
        ),
      )
    }
  }

  // Stray process.env reads in src outside the env modules ---------------

  for (const key of srcEnvRefs) {
    if (!all.has(key)) {
      findings.push(
        finding(
          "warning",
          "src-reference",
          `"${key}" is read via process.env in src/ but is not part of the validated env contract (src/lib/env*.ts). Consider documenting it in .env.example or routing it through serverEnv.`,
          { key },
        ),
      )
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function readIfExists(file) {
  const full = path.join(ROOT, file)
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null
}

function collectReal() {
  const envTs = readIfExists("src/lib/env.ts")
  const envServerTs = readIfExists("src/lib/env.server.ts")
  const envSchemaTs = readIfExists("src/lib/env-schema.ts")
  const missing = [
    ["src/lib/env.ts", envTs],
    ["src/lib/env.server.ts", envServerTs],
    ["src/lib/env-schema.ts", envSchemaTs],
  ].filter(([, text]) => text === null)
  if (missing.length > 0) {
    throw new Error(`Missing env contract source files: ${missing.map(([f]) => f).join(", ")}`)
  }

  const exampleText = readIfExists(".env.example")
  if (exampleText === null) throw new Error(".env.example not found at repository root.")

  const envFiles = new Map()
  for (const name of ENV_FILE_CANDIDATES) {
    const text = readIfExists(name)
    if (text !== null) envFiles.set(name, parseDotenvKeys(text))
  }
  // Pick up any other `.env*` files not in the candidate list.
  for (const entry of fs.readdirSync(ROOT)) {
    if (!/^\.env(\..+)?$/.test(entry) || entry === ".env.example" || envFiles.has(entry)) continue
    envFiles.set(entry, parseDotenvKeys(readIfExists(entry) ?? ""))
  }

  const srcEnvRefs = new Set()
  const srcDir = path.join(ROOT, "src")
  for (const file of walkSrc(srcDir)) {
    if (SRC_ENV_MODULES.has(path.relative(ROOT, file).split(path.sep).join("/"))) continue
    for (const key of processEnvRefs(fs.readFileSync(file, "utf8"))) srcEnvRefs.add(key)
  }

  return {
    sections: extractContract({ envTs, envServerTs, envSchemaTs }),
    exampleKeys: parseDotenvKeys(exampleText),
    envFiles,
    srcEnvRefs,
  }
}

// ---------------------------------------------------------------------------
// Demo fixture — exercises every finding severity without touching the repo.
// ---------------------------------------------------------------------------

const DEMO = {
  sections: (() => {
    const mk = (keys) => new Set(keys)
    return {
      clientSchema: mk(["NODE_ENV", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_DEMO_FLAG"]),
      serverSchema: mk(["NODE_ENV", "NEXT_PUBLIC_LEAKED", "DATABASE_URL", "SESSION_SECRET"]),
      buildSchema: mk(["CI", "ANALYZE", "SENTRY_AUTH_TOKEN"]),
      clientExpectations: mk(["NODE_ENV", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_DEMO_FLAG"]),
      serverExpectations: mk(["DATABASE_URL", "SESSION_SECRET", "NEXT_PUBLIC_LEAKED"]),
      buildExpectations: mk(["CI", "ANALYZE", "SENTRY_AUTH_TOKEN"]),
      configuredEnvKeys: mk([
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_DEMO_FLAG",
        "NEXT_PUBLIC_LEAKED",
        "DATABASE_URL",
        "SESSION_SECRET",
        "SENTRY_AUTH_TOKEN",
      ]),
      rawClientEnv: mk(["NODE_ENV", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_DEMO_FLAG"]),
      __all: new Set(),
    }
  })(),
  exampleKeys: new Set([
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_DEMO_FLAG",
    "NEXT_PUBLIC_LEAKED",
    "DATABASE_URL",
    "SESSION_SECRET",
    "SENTRY_AUTH_TOKEN",
    "DEMO_ORPHAN_KEY",
  ]),
  envFiles: new Map([
    [".env.local", new Set(["NEXT_PUBLIC_SITE_URL", "DEMO_UNDOCUMENTED_LOCAL"])],
    [".env.production", new Set(["DATABASE_URL", "SESSION_SECRET"])],
  ]),
  srcEnvRefs: new Set(["DATABASE_URL", "REPLICA_DATABASE_URL"]),
}
DEMO.sections.__all = new Set(
  [
    DEMO.sections.clientSchema,
    DEMO.sections.serverSchema,
    DEMO.sections.buildSchema,
    DEMO.sections.clientExpectations,
    DEMO.sections.serverExpectations,
    DEMO.sections.buildExpectations,
    DEMO.sections.configuredEnvKeys,
    DEMO.sections.rawClientEnv,
  ].flatMap((s) => [...s]),
)

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

function summarize(findings) {
  const summary = { error: 0, warning: 0, info: 0 }
  for (const f of findings) summary[f.severity] += 1
  return summary
}

function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.check.localeCompare(b.check) ||
      a.message.localeCompare(b.message),
  )
}

function buildReport(input, findings, meta) {
  const sorted = sortFindings(findings)
  return {
    tool: "env-parity",
    generatedAt: new Date().toISOString(),
    root: meta.root,
    mode: meta.mode,
    summary: summarize(sorted),
    contract: {
      exampleKeys: input.exampleKeys.size,
      schemaKeys: input.sections.__all.size,
      configuredEnvKeys: input.sections.configuredEnvKeys.size,
      clientKeys: new Set([
        ...input.sections.clientSchema,
        ...input.sections.clientExpectations,
        ...input.sections.rawClientEnv,
      ]).size,
      envFiles: [...input.envFiles.entries()].map(([file, keys]) => ({
        file,
        keys: [...keys].sort(),
      })),
      srcEnvRefs: input.srcEnvRefs.size,
    },
    findings: sorted,
  }
}

function renderMarkdown(report) {
  const lines = []
  lines.push("# Environment parity report")
  lines.push("")
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Root: \`${report.root}\``)
  lines.push(`- Mode: ${report.mode}`)
  lines.push(
    `- Findings: ${report.summary.error} error(s), ${report.summary.warning} warning(s), ${report.summary.info} info`,
  )
  lines.push("")
  lines.push("## Contract coverage")
  lines.push("")
  lines.push(`- .env.example keys: ${report.contract.exampleKeys}`)
  lines.push(`- Schema/expectation keys: ${report.contract.schemaKeys}`)
  lines.push(`- configuredEnvKeys entries: ${report.contract.configuredEnvKeys}`)
  lines.push(`- Client-exposed keys: ${report.contract.clientKeys}`)
  lines.push(`- src process.env references outside env modules: ${report.contract.srcEnvRefs}`)
  lines.push("")
  for (const { file, keys } of report.contract.envFiles) {
    lines.push(`- \`${file}\`: ${keys.length} key(s) present — ${keys.join(", ") || "(none)"}`)
  }
  lines.push("")
  lines.push("## Findings")
  lines.push("")
  if (report.findings.length === 0) {
    lines.push("No findings — environment contracts are in parity.")
  } else {
    lines.push("| Severity | Check | Key | File | Message |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const f of report.findings) {
      lines.push(
        `| ${f.severity} | ${f.check} | ${f.key ?? ""} | ${f.file ?? ""} | ${f.message.replace(/\|/g, "\\|")} |`,
      )
    }
  }
  lines.push("")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { ci: false, demo: false, dryRun: false, json: false, reportDir: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--ci") args.ci = true
    else if (arg === "--demo") args.demo = true
    else if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--json") args.json = true
    else if (arg === "--report-dir") {
      args.reportDir = argv[i + 1]
      i += 1
      if (!args.reportDir) throw new Error("--report-dir requires a directory argument.")
    } else if (arg === "--help" || arg === "-h") {
      args.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return args
}

const USAGE = `Usage: node scripts/config/env-parity.mjs [options]

Options:
  --ci           CI mode: exit 1 on errors AND warnings (strict gating).
  --demo         Run against a built-in fixture; always exits 0.
  --dry-run      Do not write report files even if --report-dir is given.
  --json         Print the JSON report instead of markdown.
  --report-dir <dir>  Write environment-parity.md and environment-parity.json.
  -h, --help     Show this help.

Exit codes: 0 = parity OK (warnings allowed unless --ci), 1 = findings or
collection error, 2 = usage error or unexpected failure.`

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`env-parity: ${error.message}\n\n${USAGE}`)
    process.exit(2)
  }
  if (args.help) {
    console.log(USAGE)
    return
  }

  let input
  let meta
  try {
    if (args.demo) {
      input = DEMO
      meta = { root: "(demo fixture)", mode: "demo" }
    } else {
      input = collectReal()
      meta = { root: ROOT, mode: args.ci ? "ci" : "local" }
    }
  } catch (error) {
    console.error(`env-parity: FAIL — ${error.message}`)
    process.exit(1)
  }

  const findings = runChecks(input)
  const report = buildReport(input, findings, meta)

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderMarkdown(report))
  }

  if (args.reportDir && !args.dryRun && !args.demo) {
    fs.mkdirSync(args.reportDir, { recursive: true })
    fs.writeFileSync(path.join(args.reportDir, "environment-parity.md"), renderMarkdown(report))
    fs.writeFileSync(
      path.join(args.reportDir, "environment-parity.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    console.error(`env-parity: report written to ${args.reportDir}`)
  }

  const { error: errors, warning: warnings } = report.summary
  if (args.demo) {
    console.error(
      `env-parity: demo run — ${errors} error(s), ${warnings} warning(s) (demo always exits 0)`,
    )
    return
  }
  if (errors > 0 || (args.ci && warnings > 0)) {
    console.error(
      `env-parity: FAIL — ${errors} error(s), ${warnings} warning(s)` +
        (args.ci ? " (CI mode treats warnings as failures)" : ""),
    )
    process.exit(1)
  }
  console.error(`env-parity: OK — ${warnings} warning(s), no errors.`)
}

try {
  main()
} catch (error) {
  console.error(`env-parity: FAIL — unexpected error: ${error.stack ?? error.message}`)
  process.exit(2)
}
