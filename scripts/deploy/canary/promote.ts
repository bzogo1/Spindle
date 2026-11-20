/**
 * Canary promotion: shift 100% of traffic to the canary build.
 *
 * Runs SPINDLE_CANARY_PROMOTE_CMD when configured (the operator's cutover —
 * e.g. retagging the stable image, reloading the router, or scaling the
 * canary service up); otherwise falls back to SPINDLE_CANARY_ROUTER_CMD with
 * {weight}=100. The smoke gate then verifies the promoted build.
 *
 * Usage:
 *   tsx scripts/deploy/canary/promote.ts [--dry-run]
 */

import { readCanaryConfig, type CanaryConfig } from "./lib/config"
import {
  canaryEnv,
  describeConfig,
  executorFor,
  main,
  parseArgs,
  renderRouterCommand,
  smokeGate,
} from "./lib/runner"

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config: CanaryConfig = readCanaryConfig(canaryEnv(), args.overrides)
  const execute = executorFor(args.dryRun)

  console.log(`Canary promote (${args.dryRun ? "dry-run" : "live"}):`)
  for (const line of describeConfig(config)) console.log(`  ${line}`)
  console.log("")

  if (config.promoteCmd) {
    console.log("  running SPINDLE_CANARY_PROMOTE_CMD")
    await execute(config.promoteCmd)
  } else if (config.routerCmd) {
    const command = renderRouterCommand(config.routerCmd, 100)
    console.log("  shifting 100% of traffic to the canary build")
    await execute(command)
  } else {
    throw new Error(
      "Nothing to promote with: set SPINDLE_CANARY_PROMOTE_CMD or " + "SPINDLE_CANARY_ROUTER_CMD",
    )
  }

  if (!args.dryRun) {
    await smokeGate(config)
  } else {
    console.log(`  [dry-run] would poll ${config.smokeUrl ?? "<no SPINDLE_CANARY_SMOKE_URL>"}`)
  }

  console.log("")
  console.log("Promotion complete. Redeploy or remove the canary slot at your leisure.")
}

void main(run)
