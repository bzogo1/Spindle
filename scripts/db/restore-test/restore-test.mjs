#!/usr/bin/env node
// Restore-test pipeline for Spindle backups.
//
//   node scripts/db/restore-test/restore-test.mjs [options]
//
// Picks a backup file (produced by scripts/db/backup or any pg_dump output),
// restores it into a throwaway scratch database on the same Postgres server,
// verifies the restore (table presence, row counts, prisma migrate status),
// then drops the scratch database. Nothing touches the real database.
//
//   --file <path>        explicit backup file (.dump, .backup, .sql, .sql.gz)
//   --backup-dir <dir>   scan this dir for the newest backup (default: backups/)
//   --scratch-db <name>  scratch database name (default: spindle_restore_test_<ts>)
//   --admin-db <name>    database used for CREATE/DROP DATABASE (default: postgres)
//   --keep               keep the scratch database after a successful run
//   --no-verify          skip verification queries
//   --format <fmt>       custom | plain (auto-detected from extension)
//   --dry-run            print the plan without touching any database
//
// Requires pg client binaries (pg_restore/psql) for real runs and a Postgres
// role that can CREATE DATABASE. See docs/runbooks/database-restore-test.md.
/* eslint-disable no-restricted-properties --
   entrypoint script: reads DATABASE_URL/DIRECT_URL before any app code loads,
   so src/lib/env.ts cannot be used here. */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenv } from "dotenv"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const PRISMA_SCHEMA = join(root, "prisma", "schema.prisma")
const PRISMA_BIN = join(root, "node_modules", ".bin", "prisma")
const PG_RESTORE_BIN = process.env.RESTORE_TEST_PG_RESTORE ?? "pg_restore"
const PSQL_BIN = process.env.RESTORE_TEST_PSQL ?? "psql"
const GZIP_BIN = process.env.RESTORE_TEST_GZIP ?? "gzip"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const optionValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const DRY_RUN = flags.has("--dry-run")
const KEEP = flags.has("--keep")
const SKIP_VERIFY = flags.has("--no-verify")
const FILE = optionValue("file", null)
const BACKUP_DIR = resolve(
  root,
  optionValue("backup-dir", process.env.RESTORE_TEST_BACKUP_DIR ?? "backups"),
)
const ADMIN_DB = optionValue("admin-db", process.env.RESTORE_TEST_ADMIN_DB ?? "postgres")
const FORMAT_OVERRIDE = optionValue("format", null)
const stamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, "")
  .slice(0, 14)
const SCRATCH_DB = optionValue("scratch-db", `spindle_restore_test_${stamp}`)

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const startedAt = Date.now()
let failures = 0

function log(message) {
  console.log(`  ${message}`)
}

function step(title) {
  console.log(`\n== ${title} ==`)
}

function ok(message) {
  console.log(`  ✓ ${message}`)
}

function warn(message) {
  console.log(`  ! ${message}`)
}

function fail(message) {
  failures += 1
  console.error(`  ✗ ${message}`)
}

// ---------------------------------------------------------------------------
// Environment (same dotenv order Prisma uses)
// ---------------------------------------------------------------------------

loadDotenv({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true })

const sourceUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL

// ---------------------------------------------------------------------------
// Backup discovery
// ---------------------------------------------------------------------------

const BACKUP_EXTENSIONS = [".dump", ".backup", ".pgdump", ".sql", ".sql.gz"]

function looksLikeBackup(name) {
  return BACKUP_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function detectFormat(file) {
  if (FORMAT_OVERRIDE === "custom" || FORMAT_OVERRIDE === "plain") return FORMAT_OVERRIDE
  if (/\.sql\.gz$/i.test(file)) return "plain-gz"
  if (/\.(dump|backup|pgdump)$/i.test(file)) return "custom"
  if (/\.sql$/i.test(file)) return "plain"
  return null
}

function findBackupFile() {
  if (FILE) {
    const resolved = resolve(root, FILE)
    if (!existsSync(resolved)) {
      if (DRY_RUN) {
        warn(`--file ${FILE} does not exist — dry-run uses it as a placeholder path`)
        return resolved
      }
      fail(`--file ${FILE} does not exist`)
      return null
    }
    return resolved
  }
  if (!existsSync(BACKUP_DIR)) {
    if (DRY_RUN) {
      warn(`backup dir ${BACKUP_DIR} does not exist — dry-run uses a placeholder path`)
      return join(BACKUP_DIR, "<latest>.dump")
    }
    fail(`backup dir ${BACKUP_DIR} does not exist — pass --file or --backup-dir`)
    return null
  }
  const candidates = readdirSync(BACKUP_DIR)
    .filter(looksLikeBackup)
    .map((name) => join(BACKUP_DIR, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (candidates.length === 0) {
    if (DRY_RUN) {
      warn(
        `no backup files (${BACKUP_EXTENSIONS.join(", ")}) in ${BACKUP_DIR} — dry-run uses a placeholder path`,
      )
      return join(BACKUP_DIR, "<latest>.dump")
    }
    fail(`no backup files (${BACKUP_EXTENSIONS.join(", ")}) found in ${BACKUP_DIR}`)
    return null
  }
  return candidates[0]
}

// ---------------------------------------------------------------------------
// URL helpers — swap the database name to point at the scratch DB.
// ---------------------------------------------------------------------------

function urlForDatabase(baseUrl, database) {
  const url = new URL(baseUrl)
  url.pathname = `/${database}`
  return url.toString()
}

function adminUrlFor(baseUrl) {
  return urlForDatabase(baseUrl, ADMIN_DB)
}

function scratchUrlOrPlaceholder() {
  if (!sourceUrl) return "<DATABASE_URL/DIRECT_URL with database swapped to scratch>"
  return urlForDatabase(sourceUrl, SCRATCH_DB)
}

// ---------------------------------------------------------------------------
// Schema introspection (pure file read — safe in dry-run)
// ---------------------------------------------------------------------------

function expectedTables() {
  if (!existsSync(PRISMA_SCHEMA)) return []
  const schema = readFileSync(PRISMA_SCHEMA, "utf8")
  const tables = []
  for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, modelName, body] = match
    const mapped = body.match(/@@map\("([^"]+)"\)/)
    tables.push(mapped ? mapped[1] : modelName)
  }
  return tables
}

// ---------------------------------------------------------------------------
// Process runner — dry-run prints instead of executing.
// ---------------------------------------------------------------------------

function run(command, commandArgs, { env, input } = {}) {
  const display = [command, ...commandArgs].join(" ")
  if (DRY_RUN) {
    log(`dry-run: would run: ${display}${input ? "  < <backup file>" : ""}`)
    return { status: 0, stdout: "", dryRun: true }
  }
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: input ? ["pipe", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  if (result.error) {
    fail(`${display} failed to start: ${result.error.message}`)
    return { status: 1, stdout: result.stdout ?? "" }
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "" }
}

// ---------------------------------------------------------------------------
// pg helpers
// ---------------------------------------------------------------------------

async function connectPg(connectionString, label) {
  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString })
  try {
    await client.connect()
  } catch (error) {
    fail(`could not connect to ${label}: ${error.message}`)
    return null
  }
  return client
}

async function withClient(connectionString, label, fn) {
  const client = await connectPg(connectionString, label)
  if (!client) return false
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

function validIdentifier(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

function preflight() {
  step("preflight")

  if (!validIdentifier(SCRATCH_DB)) {
    fail(`scratch database name "${SCRATCH_DB}" is not a safe SQL identifier`)
    return false
  }

  if (!existsSync(PRISMA_BIN)) {
    warn(`prisma CLI not found at ${PRISMA_BIN} — migrate status check will be skipped`)
  }

  if (!sourceUrl) {
    const message = "DATABASE_URL/DIRECT_URL is not set (checked env, .env.local, .env)"
    if (DRY_RUN) warn(`${message} — dry-run continues without it`)
    else fail(`${message} — required for a real restore test`)
  } else {
    ok("source database URL is set")
  }

  if (!KEEP && !validIdentifier(SCRATCH_DB)) {
    fail("refusing to manage an unsafe scratch database name")
    return false
  }
  return failures === 0 || DRY_RUN
}

function pickBackup() {
  step("select backup")
  const file = findBackupFile()
  if (!file) return null
  const format = detectFormat(file)
  if (!format && !DRY_RUN) {
    fail(`cannot detect backup format for ${basename(file)} — pass --format custom|plain`)
    return null
  }
  log(`backup file: ${file}`)
  log(`detected format: ${format ?? "unknown (would need --format)"}`)
  log(`scratch database: ${SCRATCH_DB} on the same server as the source URL`)
  return { file, format: format ?? "custom" }
}

async function createScratchDb() {
  step("create scratch database")
  if (DRY_RUN) {
    log(`dry-run: would connect to "${ADMIN_DB}" and run: CREATE DATABASE ${SCRATCH_DB}`)
    return true
  }
  if (!sourceUrl) {
    fail("DATABASE_URL/DIRECT_URL required to create the scratch database")
    return false
  }
  const adminUrl = adminUrlFor(sourceUrl)
  const client = await connectPg(adminUrl, `admin database "${ADMIN_DB}"`)
  if (!client) {
    // Some managed hosts name the maintenance database differently; try the
    // source database itself — CREATE DATABASE works from any database.
    warn(`falling back to the source database for CREATE DATABASE`)
    const fallback = await connectPg(sourceUrl, "source database")
    if (!fallback) return false
    try {
      await fallback.query(`CREATE DATABASE "${SCRATCH_DB}"`)
      ok(`created scratch database ${SCRATCH_DB}`)
      return true
    } catch (error) {
      fail(`CREATE DATABASE ${SCRATCH_DB} failed: ${error.message}`)
      return false
    } finally {
      await fallback.end().catch(() => {})
    }
  }
  try {
    await client.query(`CREATE DATABASE "${SCRATCH_DB}"`)
    ok(`created scratch database ${SCRATCH_DB}`)
    return true
  } catch (error) {
    fail(`CREATE DATABASE ${SCRATCH_DB} failed: ${error.message}`)
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

function restoreIntoScratch(file, format) {
  step(`restore (${format})`)
  const scratchUrl = scratchUrlOrPlaceholder()

  if (format === "custom") {
    const result = run(PG_RESTORE_BIN, [
      "--no-owner",
      "--no-privileges",
      "--dbname",
      scratchUrl,
      file,
    ])
    if (result.status !== 0 && !result.dryRun) {
      fail(`pg_restore exited ${result.status}`)
      return false
    }
  } else if (format === "plain-gz") {
    // zcat | psql — stream the compressed dump into psql stdin.
    const display = `gzip -dc ${file} | ${PSQL_BIN} ${scratchUrl}`
    if (DRY_RUN) {
      log(`dry-run: would run: ${display}`)
      return true
    }
    const gz = spawnSync(GZIP_BIN, ["-dc", file], {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 512,
    })
    if (gz.status !== 0) {
      fail(`gzip -dc ${file} failed`)
      return false
    }
    const result = spawnSync(PSQL_BIN, [scratchUrl], {
      cwd: root,
      input: gz.stdout,
      stdio: ["pipe", "pipe", "inherit"],
      encoding: "utf8",
      env: process.env,
    })
    if (result.status !== 0) {
      fail(`psql exited ${result.status}`)
      return false
    }
  } else {
    // plain .sql
    const result = run(PSQL_BIN, ["-v", "ON_ERROR_STOP=1", "-f", file, scratchUrl])
    if (result.status !== 0 && !result.dryRun) {
      fail(`psql exited ${result.status}`)
      return false
    }
  }

  if (!DRY_RUN) ok(`restore into ${SCRATCH_DB} finished`)
  else ok("restore command planned")
  return true
}

async function verify() {
  step("verification")
  if (SKIP_VERIFY) {
    warn("verification skipped (--no-verify)")
    return
  }

  const expected = expectedTables()
  log(`expected tables from prisma/schema.prisma: ${expected.join(", ") || "(none parsed)"}`)

  if (DRY_RUN) {
    log("dry-run: would connect to the scratch database and run:")
    log("  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    for (const table of expected) {
      log(`  SELECT COUNT(*) FROM "${table}"`)
    }
    log("  SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations")
    if (existsSync(PRISMA_BIN)) {
      log(`dry-run: would run: prisma migrate status (DATABASE_URL=<scratch url>)`)
    }
    return
  }
  if (!sourceUrl) {
    fail("DATABASE_URL/DIRECT_URL required for verification")
    return
  }

  const scratchUrl = urlForDatabase(sourceUrl, SCRATCH_DB)

  const verified = await withClient(
    scratchUrl,
    `scratch database ${SCRATCH_DB}`,
    async (client) => {
      const tables = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
      const existing = new Set(tables.rows.map((r) => r.table_name))
      const missing = expected.filter((t) => !existing.has(t))
      if (missing.length > 0) {
        fail(`expected tables missing after restore: ${missing.join(", ")}`)
      } else {
        ok(`all ${expected.length} expected table(s) present`)
      }

      for (const table of expected.filter((t) => existing.has(t))) {
        try {
          const count = await client.query(`SELECT COUNT(*)::bigint AS n FROM "${table}"`)
          ok(`${table}: ${count.rows[0].n} row(s)`)
        } catch (error) {
          fail(`row count for ${table} failed: ${error.message}`)
        }
      }

      if (existing.has("_prisma_migrations")) {
        const migrations = await client.query(
          "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name",
        )
        const rows = migrations.rows
        const applied = rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null)
        const incomplete = rows.filter((r) => r.finished_at === null)
        const local = localMigrationNames()
        const localSet = new Set(local)
        const drift = [...applied.map((r) => r.migration_name)].filter((m) => !localSet.has(m))
        if (incomplete.length > 0) {
          fail(`${incomplete.length} migration(s) in _prisma_migrations never finished`)
        }
        if (drift.length > 0) {
          warn(`restored migrations not present locally: ${drift.join(", ")}`)
        }
        ok(`${applied.length} migration(s) applied and finished in restored data`)
      } else {
        warn("_prisma_migrations table not found — backup may predate migrations or be partial")
      }
      return true
    },
  )
  if (!verified) return

  if (existsSync(PRISMA_BIN)) {
    step("prisma migrate status (against scratch db)")
    const scratchUrl = urlForDatabase(sourceUrl, SCRATCH_DB)
    const status = run(PRISMA_BIN, ["migrate", "status"], {
      env: { DATABASE_URL: scratchUrl, DIRECT_URL: scratchUrl },
    })
    if (status.status !== 0 && !status.dryRun) {
      warn(`prisma migrate status exited ${status.status} — review output above`)
    } else if (!status.dryRun) {
      ok("prisma migrate status clean")
    }
  }
}

function localMigrationNames() {
  const dir = join(root, "prisma", "migrations")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

async function teardown() {
  step("teardown")
  if (KEEP) {
    warn(`--keep set: scratch database ${SCRATCH_DB} was left in place`)
    return
  }
  if (DRY_RUN) {
    log(
      `dry-run: would connect to "${ADMIN_DB}" and run: DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`,
    )
    return
  }
  if (!sourceUrl) return
  const adminUrl = adminUrlFor(sourceUrl)
  const client = await connectPg(adminUrl, `admin database "${ADMIN_DB}"`)
  if (!client) {
    const fallback = await connectPg(sourceUrl, "source database")
    if (!fallback) {
      fail(`could not connect to drop scratch database ${SCRATCH_DB} — drop it manually`)
      return
    }
    try {
      await fallback.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`)
      ok(`dropped scratch database ${SCRATCH_DB}`)
    } catch (error) {
      fail(`DROP DATABASE ${SCRATCH_DB} failed: ${error.message}`)
    } finally {
      await fallback.end().catch(() => {})
    }
    return
  }
  try {
    await client.query(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`)
    ok(`dropped scratch database ${SCRATCH_DB}`)
  } catch (error) {
    fail(`DROP DATABASE ${SCRATCH_DB} failed: ${error.message}`)
  } finally {
    await client.end().catch(() => {})
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(
    DRY_RUN
      ? "[restore-test] DRY RUN — no commands will execute, no database will be touched"
      : "[restore-test] starting restore test",
  )

  if (!preflight()) {
    console.error("[restore-test] preflight failed")
    process.exit(1)
  }

  const backup = pickBackup()
  if (!backup) process.exit(1)

  const created = await createScratchDb()
  if (!created && !DRY_RUN) {
    console.error("[restore-test] could not create scratch database")
    process.exit(1)
  }

  let restored
  try {
    restored = restoreIntoScratch(backup.file, backup.format)
    if (restored) await verify()
  } finally {
    await teardown()
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (failures > 0 || (!restored && !DRY_RUN)) {
    console.error(`[restore-test] finished with ${failures} failure(s) in ${seconds}s`)
    process.exit(1)
  }
  console.log(`[restore-test] finished successfully in ${seconds}s`)
}

main().catch((error) => {
  console.error(`[restore-test] unexpected error: ${error?.stack ?? error}`)
  process.exit(1)
})
