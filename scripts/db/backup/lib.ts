// Shared helpers for the Spindle database backup scripts.
//
// Everything here is deliberately free of DB client imports so that
// `--dry-run` works in sandboxes without a live PostgreSQL and without
// pg_dump/pg_restore installed.
/* eslint-disable no-restricted-properties --
   shared script helper: reads DATABASE_URL/DIRECT_URL/BACKUP_* overrides
   before any app code loads, so src/lib/env.ts cannot be used here. */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadDotenv } from "dotenv"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

// Mirror Prisma's own resolution order so DATABASE_URL/DIRECT_URL behave the
// same whether a script or the CLI reads them.
loadDotenv({ path: [join(ROOT, ".env.local"), join(ROOT, ".env")], quiet: true })

// ---------------------------------------------------------------------------
// Configuration (all overridable via env; see docs/runbooks/database-backup.md)
// ---------------------------------------------------------------------------

export interface BackupConfig {
  dryRun: boolean
  ci: boolean
  backupDir: string
  format: "custom" | "plain"
  retentionCount: number
  encrypt: "none" | "openssl" | "gpg"
  passphrase?: string
  pgDumpBin: string
  pgRestoreBin: string
  opensslBin: string
  gpgBin: string
  databaseUrl?: string
  directUrl?: string
}

export function parseArgs(argv: string[], defaults: Partial<BackupConfig> = {}): BackupConfig {
  const flags = new Set(argv.filter((a) => a.startsWith("--")))
  const value = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? fallback : argv[i + 1]
  }

  const format = (value("format", process.env.BACKUP_FORMAT ?? "custom") ?? "custom").toLowerCase()
  const encrypt = (value("encrypt", process.env.BACKUP_ENCRYPT ?? "none") ?? "none").toLowerCase()
  const keep = Number.parseInt(
    value("keep", process.env.BACKUP_RETENTION_COUNT ?? "14") ?? "14",
    10,
  )

  let passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE
  const keyFile = process.env.BACKUP_ENCRYPTION_KEY_FILE
  if (!passphrase && keyFile && existsSync(keyFile)) {
    passphrase = readFileSync(keyFile, "utf8").trim()
  }

  return {
    dryRun: flags.has("--dry-run"),
    ci: flags.has("--ci"),
    backupDir: resolve(ROOT, value("backup-dir", process.env.BACKUP_DIR ?? "backups") ?? "backups"),
    format: format === "plain" ? "plain" : "custom",
    retentionCount: Number.isFinite(keep) && keep > 0 ? keep : 14,
    encrypt: encrypt === "openssl" || encrypt === "gpg" ? encrypt : "none",
    passphrase,
    pgDumpBin: process.env.BACKUP_PG_DUMP ?? "pg_dump",
    pgRestoreBin: process.env.BACKUP_PG_RESTORE ?? "pg_restore",
    opensslBin: process.env.BACKUP_OPENSSL ?? "openssl",
    gpgBin: process.env.BACKUP_GPG ?? "gpg",
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    ...defaults,
  }
}

// ---------------------------------------------------------------------------
// Output helpers — --ci keeps one machine-greppable line per message.
// ---------------------------------------------------------------------------

export function createLogger(script: string, ci = false) {
  let failures = 0
  return {
    get failures() {
      return failures
    },
    log(message: string) {
      console.log(ci ? `[${script}] ${message}` : `  ${message}`)
    },
    step(title: string) {
      console.log(`\n== ${title} ==`)
    },
    ok(message: string) {
      console.log(`  ✓ ${message}`)
    },
    warn(message: string) {
      console.log(`  ! ${message}`)
    },
    fail(message: string) {
      failures += 1
      console.error(`  ✗ ${message}`)
    },
    dry(message: string) {
      console.log(`  (dry-run) ${message}`)
    },
  }
}

export type Logger = ReturnType<typeof createLogger>

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

export interface RunResult {
  status: number
  stdout: string
  dryRun: boolean
}

export function run(
  command: string,
  commandArgs: string[],
  options: { dryRun?: boolean; input?: string; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const display = [command, ...commandArgs].join(" ")
  if (options.dryRun) {
    console.log(`  (dry-run) would run: ${display}`)
    return { status: 0, stdout: "", dryRun: true }
  }
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    input: options.input,
    stdio: [options.input !== undefined ? "pipe" : "ignore", "pipe", "inherit"],
    encoding: "utf8",
    env: options.env ?? process.env,
  })
  if (result.error) {
    return { status: 127, stdout: result.stdout ?? "", dryRun: false }
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", dryRun: false }
}

export function which(bin: string): boolean {
  const result = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" })
  return result.status === 0
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}
