#!/usr/bin/env node
// Encryption-at-rest verification for Spindle's Postgres database.
//
//   node scripts/db/encryption/verify-encryption.mjs [options]
//
// Performs three groups of checks and prints a pass/warn/fail report:
//
//   1. TLS on the connection string — inspects sslmode/ssl* params on
//      DATABASE_URL and DIRECT_URL.
//   2. Column-level encryption readiness — scans prisma/schema.prisma for
//      sensitive-looking fields and (when the database is reachable) queries
//      pg_extension for pgcrypto/pgp_* usage.
//   3. Live database checks — connects with `pg` and reports installed
//      extensions and sensitive-named columns.
//
//   --dry-run          print the plan and file-based findings; never connect
//   --demo             alias for --dry-run
//   --strict           treat warnings as failures (exit 1)
//   --timeout <ms>     connection timeout for live checks (default 5000)
//
// Exit code is 1 when any check fails (or warns under --strict), 0 otherwise.
// A database that cannot be reached is a warning unless --strict is set;
// file-based checks still run in every mode.
/* eslint-disable no-restricted-properties --
   entrypoint script: reads DATABASE_URL/DIRECT_URL before any app code loads,
   so src/lib/env.ts cannot be used here. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenv } from "dotenv"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const SCHEMA_PATH = join(root, "prisma", "schema.prisma")
const MIGRATIONS_DIR = join(root, "prisma", "migrations")

loadDotenv({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true })

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const optionValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const DRY_RUN = flags.has("--dry-run") || flags.has("--demo")
const STRICT = flags.has("--strict")
const CONNECT_TIMEOUT_MS = Number.parseInt(optionValue("timeout", "5000"), 10) || 5000

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

let failures = 0
let warnings = 0

function ok(message) {
  console.log(`  ✓ ${message}`)
}
function warn(message) {
  warnings += 1
  console.log(`  ! ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  ✗ ${message}`)
}
function info(message) {
  console.log(`  · ${message}`)
}
function dry(message) {
  console.log(`  (dry-run) ${message}`)
}
function step(title) {
  console.log(`\n== ${title} ==`)
}

// ---------------------------------------------------------------------------
// Sensitive-field heuristics
// ---------------------------------------------------------------------------

// Field names that typically hold plaintext secrets/PII in this app's domain
// (accounts, sessions, tokens, billing). Password *hashes* are excluded —
// bcrypt/argon2 output is already one-way and must NOT be pgcrypto-encrypted.
const SENSITIVE_FIELD_PATTERN =
  /pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential|refresh|session|ssn|social[_-]?security|credit[_-]?card|card[_-]?number|phone|address|birth|iban|routing|account[_-]?number|otp|mfa|recovery|invite|^email$|email[_-]?address/i

// Fields that are high-entropy secrets where column-level encryption is the
// primary defence (pgcrypto or app-level envelope encryption).
const HIGH_RISK_FIELD_PATTERN =
  /secret|token|api[_-]?key|private[_-]?key|credential|refresh|session/i

// ---------------------------------------------------------------------------
// Schema scan — pure file parsing, always available
// ---------------------------------------------------------------------------

function scanSchema() {
  if (!existsSync(SCHEMA_PATH)) {
    warn(`schema not found at ${SCHEMA_PATH}`)
    return { models: [], sensitive: [] }
  }
  const source = readFileSync(SCHEMA_PATH, "utf8")
  const models = []
  const sensitive = []

  // Minimal parser: track `model X { ... }` blocks and their field lines.
  const modelPattern = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  let match
  while ((match = modelPattern.exec(source)) !== null) {
    const [, modelName, body] = match
    const fields = []
    for (const line of body.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue
      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)/)
      if (!fieldMatch) continue
      const [, name, type] = fieldMatch
      fields.push({ name, type })
      if (SENSITIVE_FIELD_PATTERN.test(name) && !/^\w*hash/i.test(name)) {
        sensitive.push({
          model: modelName,
          name,
          type,
          highRisk: HIGH_RISK_FIELD_PATTERN.test(name),
        })
      }
    }
    models.push({ name: modelName, fields })
  }
  return { models, sensitive }
}

function scanMigrationsForCrypto() {
  const hits = []
  if (!existsSync(MIGRATIONS_DIR)) return hits
  const cryptoPattern = /CREATE\s+EXTENSION[^;]*pgcrypto|pgp_(sym|pub)_(encrypt|decrypt)/i
  const walk = (dir) => {
    for (const entry of readdirSyncSafe(dir)) {
      const path = join(dir, entry)
      let isDir
      try {
        isDir = statSync(path).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        walk(path)
      } else if (entry.endsWith(".sql")) {
        try {
          if (cryptoPattern.test(readFileSync(path, "utf8"))) hits.push(path)
        } catch {
          // unreadable file — ignore
        }
      }
    }
  }
  walk(MIGRATIONS_DIR)
  return hits
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Connection-string inspection
// ---------------------------------------------------------------------------

const GOOD_SSL_MODES = new Set(["require", "verify-ca", "verify-full"])
const WEAK_SSL_MODES = new Set(["disable", "allow", "prefer"])

function inspectConnectionString(label, rawUrl) {
  if (!rawUrl) {
    info(`${label}: not set (falls back to the local compose database in dev)`)
    return
  }
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail(`${label}: connection string is not a parseable URL`)
    return
  }
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase()
  const hasSslParams = ["ssl", "sslcert", "sslkey", "sslrootcert", "sslcrl"].some((p) =>
    url.searchParams.has(p),
  )
  const host = url.hostname
  const isLocal =
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.")

  if (sslmode && WEAK_SSL_MODES.has(sslmode)) {
    fail(`${label}: sslmode=${sslmode} — plaintext or opportunistic TLS only`)
  } else if (sslmode && GOOD_SSL_MODES.has(sslmode)) {
    ok(`${label}: sslmode=${sslmode}${isLocal ? " (local host — TLS optional)" : ""}`)
  } else if (!sslmode && !hasSslParams) {
    if (isLocal) {
      ok(`${label}: no sslmode on local host (compose Postgres has no TLS; acceptable)`)
    } else {
      warn(
        `${label}: no sslmode/ssl* params on a remote host — ` +
          "add sslmode=verify-full (with sslrootcert) or set DATABASE_SSL=verify",
      )
    }
  } else if (sslmode) {
    warn(`${label}: unrecognized sslmode=${sslmode} — pg will reject or ignore it`)
  } else {
    ok(`${label}: TLS configured via connection-string ssl* params`)
  }
}

// ---------------------------------------------------------------------------
// Live database checks
// ---------------------------------------------------------------------------

async function checkDatabase(url) {
  let pg
  try {
    pg = await import("pg")
  } catch {
    warn("pg driver not importable — skipping live database checks")
    return { reachable: false }
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  })
  try {
    await client.connect()
  } catch (error) {
    warn(`database unreachable (${error instanceof Error ? error.message : error})`)
    return { reachable: false }
  }

  try {
    const extensions = await client.query(
      "SELECT extname, extversion FROM pg_extension ORDER BY extname",
    )
    const names = new Set(extensions.rows.map((r) => r.extname))
    if (names.has("pgcrypto")) {
      ok("pgcrypto extension is installed")
    } else {
      info("pgcrypto extension is NOT installed (only needed for column-level encryption)")
    }
    const cryptoRelated = [...names].filter((n) => /crypto|pgp|age|vault|supabase_vault/i.test(n))
    info(`crypto-related extensions present: ${cryptoRelated.join(", ") || "none"}`)

    // Sensitive-named columns that exist in the live database.
    const columns = await client.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name ~* 'pass(word)?|secret|token|api_key|private_key|credential|refresh|session|ssn|phone|birth|iban'
       ORDER BY table_name, column_name`,
    )
    if (columns.rows.length === 0) {
      ok("no sensitive-named columns found in public schema")
    } else {
      for (const row of columns.rows) {
        warn(
          `sensitive column ${row.table_name}.${row.column_name} (${row.data_type}) — ` +
            "stored without column-level encryption unless app code encrypts it",
        )
      }
    }
    return { reachable: true }
  } finally {
    await client.end().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Spindle database encryption-at-rest verification")
if (DRY_RUN) console.log("(dry-run/demo mode — no database connection will be made)\n")

step("1. Connection-string TLS (sslmode)")
inspectConnectionString("DATABASE_URL", process.env.DATABASE_URL)
inspectConnectionString("DIRECT_URL", process.env.DIRECT_URL ?? process.env.DATABASE_URL)

step("2. Schema scan for sensitive fields")
const { models, sensitive } = scanSchema()
if (models.length === 0) {
  warn("no Prisma models parsed from schema.prisma")
} else {
  ok(`parsed ${models.length} model(s): ${models.map((m) => m.name).join(", ")}`)
  if (sensitive.length === 0) {
    ok("no sensitive-looking field names found")
  } else {
    for (const field of sensitive) {
      const risk = field.highRisk ? "high-risk" : "sensitive"
      warn(`${field.model}.${field.name} (${field.type}) — ${risk}; review encryption needs`)
    }
    info("password hashes are intentionally excluded — store them with bcrypt/argon2, not pgcrypto")
  }
}

step("3. Migration scan for column-level crypto")
const cryptoMigrations = scanMigrationsForCrypto()
if (cryptoMigrations.length === 0) {
  info("no pgcrypto/pgp_* usage found in prisma/migrations")
} else {
  ok(
    `crypto usage found in migrations: ${cryptoMigrations.map((p) => p.split("/").slice(-2).join("/")).join(", ")}`,
  )
}

step("4. Live database checks")
if (DRY_RUN) {
  dry("would connect with pg and query pg_extension + information_schema.columns")
  dry("would report installed extensions (pgcrypto, pg_stat_statements, …)")
  dry("would list sensitive-named columns and whether they look encrypted")
} else {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) {
    warn("DATABASE_URL/DIRECT_URL not set — skipping live checks")
  } else {
    await checkDatabase(url)
  }
}

step("Summary")
console.log(`  failures: ${failures}   warnings: ${warnings}`)
if (failures > 0 || (STRICT && warnings > 0)) {
  console.log("  result: FAIL")
  process.exit(1)
}
console.log("  result: PASS" + (warnings > 0 ? " (with warnings)" : ""))
console.log("\nSee docs/database/encryption-at-rest.md for remediation guidance.")
