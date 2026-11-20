#!/usr/bin/env tsx
/**
 * Roll back the last N Prisma migrations.
 *
 * Prisma does not ship "down" migrations. This script is pragmatic about that:
 *
 *   1. It lists migrations on disk and (when the database is reachable) checks
 *      `prisma migrate status` for pending/failed migrations.
 *   2. For each migration to revert it looks for a compensating SQL file —
 *      `rollback.sql` or `down.sql` inside `prisma/migrations/<name>/`.
 *   3. With a rollback file it runs `prisma db execute --file` and then
 *      `prisma migrate resolve --rolled-back <name>` to update the history
 *      table. Without one it reports the migration as MANUAL and skips it.
 *
 * `--dry-run` (and the default behaviour before any destructive step) never
 * touches the database, so the plan can be reviewed on a machine without one.
 *
 * Usage:
 *   tsx scripts/db/rollback/rollback.ts [--count N] [--dry-run] [--yes]
 */

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "../../..")
const migrationsDir = path.join(repoRoot, "prisma", "migrations")
const prismaConfig = path.join(repoRoot, "prisma7.config.ts")

const ROLLBACK_FILE_CANDIDATES = ["rollback.sql", "down.sql"] as const

interface MigrationEntry {
  name: string
  dir: string
  /** Absolute path of the compensating SQL file, when one exists. */
  rollbackFile: string | null
}

interface RollbackStep extends MigrationEntry {
  status: "pending" | "applied" | "unknown"
  action: "execute-rollback" | "manual" | "skip"
}

interface CliOptions {
  count: number
  dryRun: boolean
  yes: boolean
  help: boolean
}

function printUsage(): void {
  console.log(`Usage: tsx scripts/db/rollback/rollback.ts [options]

Options:
  -n, --count <N>   Number of most recent migrations to revert (default: 1)
      --dry-run     Print the rollback plan without touching the database
  -y, --yes         Skip the interactive confirmation prompt
  -h, --help        Show this help

Rollback SQL lookup order inside each migration directory:
  prisma/migrations/<name>/rollback.sql
  prisma/migrations/<name>/down.sql

Migrations without a rollback file are reported as MANUAL — write a
compensating migration or restore from backup instead (see
docs/runbooks/migration-rollback.md).
`)
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { count: 1, dryRun: false, yes: false, help: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "-y":
      case "--yes":
        options.yes = true
        break
      case "-n":
      case "--count": {
        const value = argv[++i]
        const parsed = Number.parseInt(value ?? "", 10)
        if (!Number.isFinite(parsed) || parsed < 1) {
          throw new Error(`Invalid --count value: ${value ?? "(missing)"}`)
        }
        options.count = parsed
        break
      }
      default:
        if (arg.startsWith("--count=")) {
          const parsed = Number.parseInt(arg.slice("--count=".length), 10)
          if (!Number.isFinite(parsed) || parsed < 1) {
            throw new Error(`Invalid --count value: ${arg}`)
          }
          options.count = parsed
        } else {
          throw new Error(`Unknown argument: ${arg}`)
        }
    }
  }

  return options
}

function listMigrations(): MigrationEntry[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`)
  }

  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const dir = path.join(migrationsDir, name)
      const rollbackFile =
        ROLLBACK_FILE_CANDIDATES.map((candidate) => path.join(dir, candidate)).find((file) =>
          existsSync(file),
        ) ?? null
      return { name, dir, rollbackFile }
    })
}

/**
 * Returns the set of migration names that are pending (not yet applied), or
 * null when the database cannot be reached or the output cannot be parsed.
 */
function getPendingMigrations(): Set<string> | null {
  const result = spawnSync("npx", ["prisma", "migrate", "status"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  })

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  if (result.error || result.status !== 0) {
    return null
  }

  // Prisma prints "Following migration(s) have not yet been applied:" followed
  // by an indented list when the database is reachable.
  const match = output.match(
    /have not yet been applied:?\s*\n([\s\S]*?)(?:\n\s*\n|To apply migrations|$)/i,
  )
  if (!match) {
    // Either everything is applied or the output format changed; treat a
    // clean run with "up to date" as "nothing pending".
    return /up to date/i.test(output) ? new Set() : null
  }

  return new Set(
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d{14}_.+/.test(line))
      .map((line) => line.replace(/\/+$/, "").split("/").pop() ?? line),
  )
}

function buildPlan(
  entries: MigrationEntry[],
  count: number,
  pending: Set<string> | null,
): RollbackStep[] {
  // Revert newest first.
  const targets = entries.slice(-count).reverse()

  return targets.map((entry) => {
    const status: RollbackStep["status"] =
      pending === null ? "unknown" : pending.has(entry.name) ? "pending" : "applied"

    let action: RollbackStep["action"]
    if (status === "pending") {
      action = "skip"
    } else if (entry.rollbackFile) {
      action = "execute-rollback"
    } else {
      action = "manual"
    }

    return { ...entry, status, action }
  })
}

function printPlan(plan: RollbackStep[]): void {
  console.log("")
  console.log("Rollback plan (newest first):")
  console.log("─".repeat(72))
  for (const step of plan) {
    const applied =
      step.status === "applied"
        ? "applied"
        : step.status === "pending"
          ? "NOT applied"
          : "unverified"
    const action =
      step.action === "execute-rollback"
        ? `run ${path.relative(repoRoot, step.rollbackFile ?? "")}`
        : step.action === "manual"
          ? "MANUAL — no rollback.sql/down.sql found"
          : "skip (not applied)"
    console.log(`  ${step.name}`)
    console.log(`    status: ${applied}   action: ${action}`)
  }
  console.log("─".repeat(72))
}

function run(cmd: string, args: string[]): number {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    timeout: 120_000,
  })
  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

function printManualInstructions(step: RollbackStep): void {
  console.log("")
  console.log(`MANUAL rollback required for ${step.name}.`)
  console.log("Options:")
  console.log("  1. Write a compensating migration:")
  console.log("       npx prisma migrate dev --name revert_<short_name>")
  console.log("     then apply the generated SQL by hand in reverse order.")
  console.log("  2. Restore the database from the pre-deploy backup.")
  console.log("  3. Add prisma/migrations/" + step.name + "/rollback.sql and re-run this script.")
  console.log("")
}

async function main(): Promise<void> {
  let options: CliOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    printUsage()
    process.exitCode = 2
    return
  }

  if (options.help) {
    printUsage()
    return
  }

  const entries = listMigrations()
  if (entries.length === 0) {
    console.log("No migrations found under prisma/migrations — nothing to roll back.")
    return
  }

  const pending = getPendingMigrations()
  const plan = buildPlan(entries, options.count, pending)

  if (pending === null) {
    console.warn(
      "Warning: could not reach the database (`prisma migrate status` failed). " +
        "Applied/pending status is unverified; the plan assumes the newest " +
        `migrations are applied. Re-run with --dry-run on a machine with DB access, or pass --yes only after verifying.`,
    )
  }

  printPlan(plan)

  const executable = plan.filter((step) => step.action === "execute-rollback")
  const manual = plan.filter((step) => step.action === "manual")
  const skipped = plan.filter((step) => step.action === "skip")

  for (const step of manual) {
    printManualInstructions(step)
  }
  for (const step of skipped) {
    console.log(`Skipping ${step.name}: migration is recorded as not applied.`)
  }

  if (options.dryRun) {
    console.log("")
    console.log("Dry run complete — no changes were made.")
    if (manual.length > 0) {
      process.exitCode = 1
    }
    return
  }

  if (executable.length === 0) {
    console.log("\nNothing executable in this plan (all targets are manual or skipped).")
    process.exitCode = manual.length > 0 ? 1 : 0
    return
  }

  if (!options.yes) {
    const ok = await confirm(`\nExecute rollback for ${executable.length} migration(s)? [y/N] `)
    if (!ok) {
      console.log("Aborted — no changes were made.")
      return
    }
  }

  let failed = false
  for (const step of executable) {
    console.log(`\nRolling back ${step.name} ...`)

    // 1. Run the compensating SQL against the database.
    const executeStatus = run("npx", [
      "prisma",
      "db",
      "execute",
      "--file",
      step.rollbackFile ?? "",
      "--config",
      prismaConfig,
    ])
    if (executeStatus !== 0) {
      console.error(`prisma db execute failed for ${step.name}; stopping.`)
      failed = true
      break
    }

    // 2. Mark the migration as rolled back in _prisma_migrations so a later
    //    `migrate deploy` does not try to re-apply it.
    const resolveStatus = run("npx", [
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      step.name,
      "--config",
      prismaConfig,
      "--schema",
      path.join(repoRoot, "prisma", "schema.prisma"),
    ])
    if (resolveStatus !== 0) {
      console.warn(
        `Could not mark ${step.name} as rolled back automatically. ` +
          `Remove its row from _prisma_migrations manually if needed.`,
      )
    }

    console.log(`Rolled back ${step.name}.`)
  }

  if (failed || manual.length > 0) {
    process.exitCode = 1
  } else {
    console.log("\nRollback complete.")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
