#!/usr/bin/env node
// Automated database migration pipeline for Spindle.
//
//   node scripts/db/migrate.mjs [options]
//
// Steps: pre-migration backup (pg_dump) -> `prisma migrate deploy` ->
// post-migration verification queries -> drift check (`prisma migrate status`
// plus an applied-vs-checksummed comparison against prisma/migrations).
//
// All database access goes through DATABASE_URL / DIRECT_URL from the
// environment or the dotenv files Prisma already reads (.env.local, .env).
// See docs/runbooks/database-migrations.md for the full pipeline contract.
//
/* eslint-disable no-restricted-properties --
   entrypoint script: it reads DATABASE_URL/DIRECT_URL and MIGRATE_* overrides
   before any app code loads, so src/lib/env.ts cannot be used here. */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenv } from "dotenv"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const PRISMA_MIGRATIONS_DIR = join(root, "prisma", "migrations")
const PRISMA_SCHEMA = join(root, "prisma", "schema.prisma")
const PRISMA_BIN = join(root, "node_modules", ".bin", "prisma")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const optionValue = (name, fallback) => {
  const prefix = `--${name}=`
  const inline = args.find((a) => a.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const DRY_RUN = flags.has("--dry-run")
const CI = flags.has("--ci")
const SKIP_BACKUP = flags.has("--skip-backup")
const SKIP_VERIFY = flags.has("--no-verify")
const BACKUP_DIR = resolve(
  root,
  optionValue("backup-dir", process.env.MIGRATE_BACKUP_DIR ?? "backups"),
)
const BACKUP_FORMAT = optionValue("format", process.env.MIGRATE_BACKUP_FORMAT ?? "custom") // custom | plain
const PG_DUMP_BIN = process.env.MIGRATE_PG_DUMP ?? "pg_dump"

// ---------------------------------------------------------------------------
// Output helpers — CI mode keeps one machine-greppable line per step result.
// ---------------------------------------------------------------------------

const startedAt = Date.now()
let failures = 0

function log(message) {
  console.log(CI ? `[migrate] ${message}` : `  ${message}`)
}

function step(title) {
  console.log(CI ? `[migrate] step: ${title}` : `\n== ${title} ==`)
}

function ok(message) {
  console.log(CI ? `[migrate] ok: ${message}` : `  ✓ ${message}`)
}

function warn(message) {
  console.log(CI ? `[migrate] warn: ${message}` : `  ! ${message}`)
}

function fail(message) {
  failures += 1
  console.error(CI ? `[migrate] fail: ${message}` : `  ✗ ${message}`)
}

function run(command, commandArgs) {
  const display = [command, ...commandArgs].join(" ")
  if (DRY_RUN) {
    log(`dry-run: would run: ${display}`)
    return { status: 0, stdout: "", dryRun: true }
  }
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    env: process.env,
  })
  if (result.error) {
    fail(`${display} failed to start: ${result.error.message}`)
    return { status: 1, stdout: result.stdout ?? "" }
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "" }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

// Mirror Prisma's own resolution order so DATABASE_URL/DIRECT_URL behave the
// same whether the script or the CLI reads them.
loadDotenv({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true })

// Mirror src/lib/database-url.ts: outside production a fresh checkout falls
// back to the compose database so `prisma migrate deploy` (via
// prisma7.config.ts) and this script's pg_dump/pg steps resolve the same URL.
const localDatabaseUrl = "postgresql://spindle:spindle@localhost:5432/spindle?schema=public"
const envProvidedUrl = Boolean(process.env.DATABASE_URL || process.env.DIRECT_URL)
// --ci counts as production: never silently fall back to localhost there.
const allowLocalFallback = process.env.NODE_ENV !== "production" && !CI
const databaseUrl = process.env.DATABASE_URL ?? (allowLocalFallback ? localDatabaseUrl : undefined)
const directUrl =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  (allowLocalFallback ? localDatabaseUrl : undefined)

// ---------------------------------------------------------------------------
// Schema introspection (pure file reads — safe in dry-run and CI sandboxes)
// ---------------------------------------------------------------------------

function expectedTables() {
  if (!existsSync(PRISMA_SCHEMA)) return []
  const schema = readFileSync(PRISMA_SCHEMA, "utf8")
  const tables = []
  for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, modelName, body] = match
    const mapped = body.match(/@@map\("([^"]+)"\)/)
    // Prisma's default table name is the model name when @@map is absent.
    tables.push(mapped ? mapped[1] : modelName)
  }
  return tables
}

function localMigrationNames() {
  if (!existsSync(PRISMA_MIGRATIONS_DIR)) return []
  return readdirSync(PRISMA_MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

function preflight() {
  step("preflight")

  if (!existsSync(PRISMA_BIN)) {
    fail(`prisma CLI not found at ${PRISMA_BIN} — run npm install first`)
    return false
  }

  if (!databaseUrl) {
    const message = "DATABASE_URL is not set (checked env, .env.local, .env)"
    if (DRY_RUN) warn(`${message} — dry-run continues without it`)
    else if (CI) fail(`${message} — required in CI mode`)
    else warn(`${message} — no local compose fallback outside production`)
  } else if (!envProvidedUrl) {
    ok("DATABASE_URL not set — using local compose database fallback")
  } else {
    ok("DATABASE_URL is set")
  }

  if (!directUrl) {
    warn("DIRECT_URL is not set; pg_dump and migrate will use DATABASE_URL")
  }
  return failures === 0
}

function backup() {
  step("pre-migration backup")

  if (SKIP_BACKUP) {
    warn("backup skipped (--skip-backup)")
    return
  }
  if (!directUrl) {
    if (DRY_RUN) {
      log(
        `dry-run: would run: ${PG_DUMP_BIN} <DATABASE_URL|DIRECT_URL> > ${BACKUP_DIR}/<timestamp>.dump`,
      )
      return
    }
    fail("no DATABASE_URL/DIRECT_URL to back up from")
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const extension = BACKUP_FORMAT === "plain" ? "sql" : "dump"
  const backupFile = join(BACKUP_DIR, `spindle-${stamp}.${extension}`)

  if (DRY_RUN) {
    log(`dry-run: would mkdir -p ${BACKUP_DIR}`)
    log(
      `dry-run: would run: ${PG_DUMP_BIN} --format=${BACKUP_FORMAT === "plain" ? "plain" : "custom"} --file=${backupFile} <DIRECT_URL>`,
    )
    log(`dry-run: backup file would contain credentials — never commit ${BACKUP_DIR}/`)
    return
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  // Backups contain full data dumps; keep them out of git without touching the
  // shared root .gitignore by planting a local ignore inside the backup dir.
  writeFileSync(join(BACKUP_DIR, ".gitignore"), "*\n!.gitignore\n")

  const dumpArgs =
    BACKUP_FORMAT === "plain"
      ? ["--format=plain", "--file", backupFile, directUrl]
      : ["--format=custom", "--file", backupFile, directUrl]

  const result = run(PG_DUMP_BIN, dumpArgs)
  if (result.status !== 0) {
    fail(`pg_dump exited ${result.status} — aborting before migrate deploy`)
    return
  }
  if (existsSync(backupFile)) ok(`backup written to ${backupFile}`)
  else warn(`pg_dump reported success but ${backupFile} was not created`)
}

function migrateDeploy() {
  step("prisma migrate deploy")
  const result = run(PRISMA_BIN, ["migrate", "deploy"])
  if (result.status !== 0) {
    fail(`prisma migrate deploy exited ${result.status}`)
    return false
  }
  ok("migrate deploy finished")
  return true
}

async function verify() {
  step("post-migration verification")

  if (SKIP_VERIFY) {
    warn("verification skipped (--no-verify)")
    return
  }
  if (DRY_RUN) {
    log("dry-run: would connect via pg and run:")
    log("  SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations")
    log("  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    log(
      `  expected tables from prisma/schema.prisma: ${expectedTables().join(", ") || "(none parsed)"}`,
    )
    return
  }
  if (!databaseUrl) {
    fail("DATABASE_URL is required for verification queries")
    return
  }

  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
  } catch (error) {
    fail(`could not connect to database for verification: ${error.message}`)
    return
  }

  try {
    const migrations = await client.query(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name",
    )
    const rows = migrations.rows
    const incomplete = rows.filter((r) => r.finished_at === null)
    const rolledBack = rows.filter((r) => r.rolled_back_at !== null)
    const applied = rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null)

    if (incomplete.length > 0) {
      fail(
        `${incomplete.length} migration(s) never finished: ${incomplete.map((r) => r.migration_name).join(", ")}`,
      )
    }
    if (rolledBack.length > 0) {
      warn(
        `${rolledBack.length} migration(s) were rolled back: ${rolledBack.map((r) => r.migration_name).join(", ")}`,
      )
    }
    ok(`${applied.length} migration(s) applied and finished`)

    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
    const existing = new Set(tables.rows.map((r) => r.table_name))
    const expected = expectedTables()
    const missing = expected.filter((t) => !existing.has(t))
    if (missing.length > 0) {
      fail(`expected tables missing from public schema: ${missing.join(", ")}`)
    } else {
      ok(`all ${expected.length} expected table(s) present`)
    }
  } catch (error) {
    fail(`verification query failed: ${error.message}`)
  } finally {
    await client.end().catch(() => {})
  }
}

async function driftCheck() {
  step("drift check")

  const local = localMigrationNames()
  log(`local migrations on disk: ${local.length}`)

  const status = run(PRISMA_BIN, ["migrate", "status"])
  if (status.status !== 0 && !DRY_RUN) {
    warn("prisma migrate status reported a non-zero exit — see output above")
  }

  if (DRY_RUN) {
    log("dry-run: would compare _prisma_migrations against prisma/migrations and fail on drift")
    return
  }
  if (!databaseUrl) {
    warn("DATABASE_URL not set — skipping applied-vs-local drift comparison")
    return
  }

  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    )
    const applied = new Set(result.rows.map((r) => r.migration_name))
    const localSet = new Set(local)

    const appliedNotLocal = [...applied].filter((m) => !localSet.has(m))
    const localNotApplied = local.filter((m) => !applied.has(m))

    if (appliedNotLocal.length > 0) {
      fail(
        `drift: applied migrations missing from prisma/migrations: ${appliedNotLocal.join(", ")}`,
      )
    }
    if (localNotApplied.length > 0) {
      fail(`drift: local migrations not applied to database: ${localNotApplied.join(", ")}`)
    }
    if (appliedNotLocal.length === 0 && localNotApplied.length === 0) {
      ok("no drift — applied migrations match prisma/migrations")
    }
  } catch (error) {
    fail(`drift check query failed: ${error.message}`)
  } finally {
    await client.end().catch(() => {})
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(
    DRY_RUN
      ? "[migrate] DRY RUN — no commands will execute, no database will be touched"
      : `[migrate] starting migration pipeline (mode: ${CI ? "ci" : "local"})`,
  )

  if (!preflight()) {
    console.error("[migrate] preflight failed")
    process.exit(1)
  }

  if (failures > 0 && !DRY_RUN && CI) {
    console.error("[migrate] preflight failures in CI mode — aborting")
    process.exit(1)
  }

  backup()
  if (failures > 0 && !DRY_RUN) {
    console.error("[migrate] backup failed — aborting before migrate deploy")
    process.exit(1)
  }

  if (!migrateDeploy()) process.exit(1)
  await verify()
  await driftCheck()

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (failures > 0) {
    console.error(`[migrate] finished with ${failures} failure(s) in ${seconds}s`)
    process.exit(1)
  }
  console.log(`[migrate] finished successfully in ${seconds}s`)
}

main().catch((error) => {
  console.error(`[migrate] unexpected error: ${error?.stack ?? error}`)
  process.exit(1)
})
