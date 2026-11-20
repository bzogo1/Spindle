#!/usr/bin/env node
// Scheduled/manual Postgres backup for Spindle.
//
//   npx tsx scripts/db/backup/backup.ts [options]
//
// Produces a pg_dump artifact in the backup directory (default backups/),
// optionally encrypts it (openssl or gpg), then prunes old artifacts down to
// the retention count. Backups are named `spindle-<timestamp>.dump` (custom
// format) or `spindle-<timestamp>.sql` (plain format); encrypted artifacts get
// an `.enc` (openssl) or `.gpg` (gpg) suffix.
//
//   --dry-run            print the plan; never run pg_dump/encrypt/prune
//   --ci                 machine-greppable [backup] output; missing
//                        DATABASE_URL is fatal instead of a warning
//   --format <fmt>       custom | plain (env BACKUP_FORMAT, default custom)
//   --backup-dir <dir>   output directory (env BACKUP_DIR, default backups/)
//   --keep <n>           retain the newest n artifacts (env
//                        BACKUP_RETENTION_COUNT, default 14)
//   --encrypt <mode>     none | openssl | gpg (env BACKUP_ENCRYPT, default
//                        none). Requires a passphrase via
//                        BACKUP_ENCRYPTION_PASSPHRASE or
//                        BACKUP_ENCRYPTION_KEY_FILE.
//   --no-prune           skip retention pruning after a successful backup
//   --help, -h           show this message
//
// The dump connects with DIRECT_URL (falling back to DATABASE_URL), matching
// scripts/db/migrate.mjs. See docs/runbooks/database-backup.md.
/* eslint-disable no-restricted-properties --
   entrypoint script: reads DATABASE_URL/DIRECT_URL/BACKUP_* before any app
   code loads, so src/lib/env.ts cannot be used here. */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createLogger, parseArgs, run, stamp, which, type BackupConfig } from "./lib"

const HELP = `Usage: npx tsx scripts/db/backup/backup.ts [options]

  --dry-run            print the plan; execute nothing
  --ci                 greppable output; missing DATABASE_URL is fatal
  --format <fmt>       custom | plain            (env BACKUP_FORMAT)
  --backup-dir <dir>   output directory         (env BACKUP_DIR, default backups/)
  --keep <n>           artifacts to retain      (env BACKUP_RETENTION_COUNT, default 14)
  --encrypt <mode>     none | openssl | gpg     (env BACKUP_ENCRYPT, default none)
  --no-prune           skip retention pruning
  --help, -h           show this message

Passphrase for --encrypt: BACKUP_ENCRYPTION_PASSPHRASE or
BACKUP_ENCRYPTION_KEY_FILE (path to a file containing the passphrase).
Binary overrides: BACKUP_PG_DUMP, BACKUP_PG_RESTORE, BACKUP_OPENSSL, BACKUP_GPG.`

const argv = process.argv.slice(2)
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}

const config = parseArgs(argv)
const NO_PRUNE = argv.includes("--no-prune")
const log = createLogger("backup", config.ci)
const startedAt = Date.now()

// ---------------------------------------------------------------------------
// Artifact naming — must stay compatible with:
//   scripts/db/restore-test/restore-test.mjs  (.dump/.sql auto-detected;
//     encrypted artifacts are intentionally NOT auto-detected — decrypt first)
//   scripts/db/monitoring/rules.json          (backup-staleness file pattern)
//   scripts/db/migrate.mjs                    (same spindle-<ts> prefix/dir)
// ---------------------------------------------------------------------------

const BACKUP_FILE_PATTERN = /^spindle-.*\.(dump|sql)(\.(enc|gpg))?$/

function artifactPaths(config: BackupConfig, when = stamp()) {
  const extension = config.format === "plain" ? "sql" : "dump"
  const base = join(config.backupDir, `spindle-${when}.${extension}`)
  if (config.encrypt === "openssl") return { plain: base, final: `${base}.enc` }
  if (config.encrypt === "gpg") return { plain: base, final: `${base}.gpg` }
  return { plain: base, final: base }
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

function preflight(): boolean {
  log.step("preflight")

  if (!config.directUrl && !config.databaseUrl) {
    const message = "DATABASE_URL/DIRECT_URL is not set (checked env, .env.local, .env)"
    if (config.dryRun) log.warn(`${message} — dry-run continues without it`)
    else if (config.ci) {
      log.fail(`${message} — required in CI mode`)
      return false
    } else log.warn(`${message} — no local compose fallback outside migrate.mjs`)
  } else {
    log.ok("database URL is set (DIRECT_URL preferred, DATABASE_URL fallback)")
  }

  if (which(config.pgDumpBin)) {
    log.ok(`pg_dump binary found: ${config.pgDumpBin}`)
  } else if (config.dryRun) {
    log.warn(`pg_dump binary "${config.pgDumpBin}" not on PATH — dry-run continues`)
  } else {
    log.fail(`pg_dump binary "${config.pgDumpBin}" not found on PATH`)
    return false
  }

  if (config.encrypt !== "none") {
    const cipherBin = config.encrypt === "openssl" ? config.opensslBin : config.gpgBin
    if (!config.passphrase) {
      const message =
        "no encryption passphrase — set BACKUP_ENCRYPTION_PASSPHRASE or BACKUP_ENCRYPTION_KEY_FILE"
      if (config.dryRun) log.warn(`${message} — dry-run continues`)
      else {
        log.fail(message)
        return false
      }
    }
    if (which(cipherBin)) {
      log.ok(`${config.encrypt} binary found: ${cipherBin}`)
    } else if (config.dryRun) {
      log.warn(`${cipherBin} not on PATH — dry-run continues`)
    } else {
      log.fail(`${cipherBin} binary not found on PATH — required for --encrypt ${config.encrypt}`)
      return false
    }
  } else {
    log.ok("encryption disabled (--encrypt none)")
  }

  log.log(`backup dir: ${config.backupDir}`)
  log.log(`format: ${config.format}   retention: keep ${config.retentionCount}`)
  return log.failures === 0
}

function backup() {
  log.step("pg_dump backup")
  const url = config.directUrl ?? config.databaseUrl
  const { plain, final } = artifactPaths(config)

  if (!url && !config.dryRun) {
    log.fail("no DATABASE_URL/DIRECT_URL to back up from")
    return null
  }

  const formatFlag = config.format === "plain" ? "plain" : "custom"
  if (config.dryRun) {
    log.dry(`would mkdir -p ${config.backupDir} and write .gitignore ("*" + "!.gitignore")`)
    log.dry(
      `would run: ${config.pgDumpBin} --format=${formatFlag} --no-password --file=${plain} <DIRECT_URL|DATABASE_URL>`,
    )
  } else {
    mkdirSync(config.backupDir, { recursive: true })
    // Backups contain full data dumps; keep them out of git without touching
    // the shared root .gitignore (same approach as scripts/db/migrate.mjs).
    writeFileSync(join(config.backupDir, ".gitignore"), "*\n!.gitignore\n")

    const result = run(
      config.pgDumpBin,
      ["--format", formatFlag, "--no-password", "--file", plain, url as string],
      { dryRun: false },
    )
    if (result.status !== 0) {
      log.fail(`pg_dump exited ${result.status} — no backup written`)
      return null
    }
    if (existsSync(plain)) log.ok(`dump written to ${plain}`)
    else {
      log.fail(`pg_dump reported success but ${plain} was not created`)
      return null
    }
  }

  return { plain, final }
}

function encrypt(plain: string, final: string): boolean {
  log.step(`encrypt (${config.encrypt})`)
  if (config.encrypt === "none") {
    log.log("skipped — encryption disabled")
    return true
  }
  if (!config.passphrase && !config.dryRun) {
    log.fail("cannot encrypt without a passphrase")
    return false
  }

  if (config.encrypt === "openssl") {
    // Passphrase travels via env var, never on the command line (visible in ps).
    const result = run(
      config.opensslBin,
      [
        "enc",
        "-aes-256-cbc",
        "-pbkdf2",
        "-salt",
        "-pass",
        "env:SPINDLE_BACKUP_PASSPHRASE",
        "-in",
        plain,
        "-out",
        final,
      ],
      {
        dryRun: config.dryRun,
        env: { ...process.env, SPINDLE_BACKUP_PASSPHRASE: config.passphrase ?? "" },
      },
    )
    if (result.status !== 0 && !result.dryRun) {
      log.fail(`openssl exited ${result.status} — plaintext backup left at ${plain}`)
      return false
    }
  } else {
    // gpg symmetric encryption; passphrase on fd 0 via --passphrase-fd.
    const result = run(
      config.gpgBin,
      [
        "--batch",
        "--yes",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "0",
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "-o",
        final,
        plain,
      ],
      { dryRun: config.dryRun, input: `${config.passphrase ?? ""}\n` },
    )
    if (result.status !== 0 && !result.dryRun) {
      log.fail(`gpg exited ${result.status} — plaintext backup left at ${plain}`)
      return false
    }
  }

  if (config.dryRun) {
    log.dry(`would encrypt ${plain} -> ${final} and delete the plaintext`)
    return true
  }
  if (!existsSync(final)) {
    log.fail(`encryption reported success but ${final} was not created`)
    return false
  }
  unlinkSync(plain)
  log.ok(`encrypted backup written to ${final} (plaintext removed)`)
  return true
}

function prune() {
  log.step(`retention (keep newest ${config.retentionCount})`)
  if (NO_PRUNE) {
    log.log("skipped (--no-prune)")
    return
  }
  if (!existsSync(config.backupDir)) {
    if (config.dryRun) log.dry(`would scan ${config.backupDir} for old artifacts`)
    else log.warn(`backup dir ${config.backupDir} does not exist — nothing to prune`)
    return
  }

  const artifacts = readdirSync(config.backupDir)
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .map((name) => join(config.backupDir, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  const expired = artifacts.slice(config.retentionCount)
  if (expired.length === 0) {
    log.ok(`${artifacts.length} artifact(s) present, none exceed retention`)
    return
  }
  for (const file of expired) {
    if (config.dryRun) {
      log.dry(`would delete ${file}`)
    } else {
      unlinkSync(file)
      log.ok(`pruned ${file}`)
    }
  }
  if (!config.dryRun)
    log.ok(`pruned ${expired.length} artifact(s); ${config.retentionCount} retained`)
}

// ---------------------------------------------------------------------------

function main() {
  console.log(
    config.dryRun
      ? "[backup] DRY RUN — no commands will execute, nothing will be written"
      : "[backup] starting database backup",
  )

  if (!preflight()) {
    console.error("[backup] preflight failed")
    process.exit(1)
  }

  const paths = backup()
  if (!paths) {
    if (!config.dryRun) {
      console.error("[backup] backup step failed")
      process.exit(1)
    }
    // Dry-run still demonstrates the encrypt/prune plan with placeholder paths.
    const placeholder = artifactPaths(config, "<timestamp>")
    if (!encrypt(placeholder.plain, placeholder.final) && !config.dryRun) {
      console.error("[backup] encryption failed")
      process.exit(1)
    }
    prune()
  } else if (encrypt(paths.plain, paths.final)) {
    prune()
  } else if (!config.dryRun) {
    console.error("[backup] encryption failed")
    process.exit(1)
  } else {
    prune()
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  if (log.failures > 0) {
    console.error(`[backup] finished with ${log.failures} failure(s) in ${seconds}s`)
    process.exit(1)
  }
  console.log(`[backup] finished successfully in ${seconds}s`)
}

main()
