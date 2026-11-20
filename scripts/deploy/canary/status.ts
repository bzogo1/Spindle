/**
 * Canary status: print the resolved rollout configuration and run
 * SPINDLE_CANARY_STATUS_CMD when one is configured (e.g. a router or
 * compose probe that reports current weights and canary health).
 *
 * Usage:
 *   tsx scripts/deploy/canary/status.ts [--dry-run]
 */

import { readCanaryConfig, type CanaryConfig } from "./lib/config"
import { canaryEnv, describeConfig, executorFor, main, parseArgs } from "./lib/runner"

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config: CanaryConfig = readCanaryConfig(canaryEnv(), args.overrides)

  console.log(`Canary configuration (${args.dryRun ? "dry-run" : "live"}):`)
  for (const line of describeConfig(config)) console.log(`  ${line}`)

  if (config.statusCmd) {
    console.log("")
    console.log("  status probe:")
    const execute = executorFor(args.dryRun)
    await execute(config.statusCmd)
  }
}

void main(run)
