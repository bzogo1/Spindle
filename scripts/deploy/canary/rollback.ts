/**
 * Canary rollback: drain traffic off the canary build.
 *
 * Runs SPINDLE_CANARY_ROLLBACK_CMD when configured; otherwise falls back to
 * SPINDLE_CANARY_ROUTER_CMD with {weight}=0. Use this any time a canary stage
 * misbehaves — deploy.ts also invokes it automatically on gate failure.
 *
 * Usage:
 *   tsx scripts/deploy/canary/rollback.ts [--dry-run]
 */

import { readCanaryConfig, type CanaryConfig } from "./lib/config"
import {
  canaryEnv,
  describeConfig,
  executorFor,
  main,
  parseArgs,
  renderRouterCommand,
} from "./lib/runner"

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config: CanaryConfig = readCanaryConfig(canaryEnv(), args.overrides)
  const execute = executorFor(args.dryRun)

  console.log(`Canary rollback (${args.dryRun ? "dry-run" : "live"}):`)
  for (const line of describeConfig(config)) console.log(`  ${line}`)
  console.log("")

  if (config.rollbackCmd) {
    console.log("  running SPINDLE_CANARY_ROLLBACK_CMD")
    await execute(config.rollbackCmd)
  } else if (config.routerCmd) {
    const command = renderRouterCommand(config.routerCmd, 0)
    console.log("  shifting 0% of traffic to the canary build")
    await execute(command)
  } else {
    console.warn(
      "  WARN: no SPINDLE_CANARY_ROLLBACK_CMD or SPINDLE_CANARY_ROUTER_CMD; " +
        "nothing to roll back",
    )
  }

  console.log("")
  console.log("Rollback issued. Stable traffic is unaffected; the canary slot can be torn down.")
}

void main(run)
