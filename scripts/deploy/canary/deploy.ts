/**
 * Canary rollout: deploy the candidate image to the canary slot, then step
 * traffic through SPINDLE_CANARY_WEIGHTS, holding each stage for
 * SPINDLE_CANARY_STAGE_SECONDS while the smoke and metric gates run.
 *
 * On any gate failure the script shifts traffic back to 0% (or runs
 * SPINDLE_CANARY_ROLLBACK_CMD) before exiting non-zero.
 *
 * Usage:
 *   tsx scripts/deploy/canary/deploy.ts [--dry-run] [--image <ref>]
 *     [--weights 5,25,50] [--stage-seconds 300]
 *
 * Configuration: SPINDLE_CANARY_* environment variables — see
 * lib/config.ts and docs/deploy/canary.md.
 */

import { readCanaryConfig, type CanaryConfig } from "./lib/config"
import {
  canaryEnv,
  describeConfig,
  executorFor,
  main,
  observeStage,
  parseArgs,
  renderRouterCommand,
} from "./lib/runner"

async function setWeight(
  config: CanaryConfig,
  execute: (command: string) => Promise<void>,
  weight: number,
): Promise<void> {
  if (!config.routerCmd) {
    console.log(`  no router configured; weight ${weight}% not applied`)
    return
  }
  const command = renderRouterCommand(config.routerCmd, weight)
  console.log(`  shifting traffic to ${weight}%`)
  await execute(command)
}

async function rollbackTraffic(
  config: CanaryConfig,
  execute: (command: string) => Promise<void>,
): Promise<void> {
  if (config.rollbackCmd) {
    console.log("  rolling back via SPINDLE_CANARY_ROLLBACK_CMD")
    await execute(config.rollbackCmd)
  } else {
    await setWeight(config, execute, 0)
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config = readCanaryConfig(canaryEnv(), args.overrides)
  const execute = executorFor(args.dryRun)

  if (!config.image) {
    throw new Error("No canary image: set SPINDLE_CANARY_IMAGE or pass --image <ref>")
  }
  if (config.routerCmd && !config.routerCmd.includes("{weight}")) {
    throw new Error("SPINDLE_CANARY_ROUTER_CMD must contain a {weight} placeholder")
  }

  console.log(`Canary rollout plan (${args.dryRun ? "dry-run" : "live"}):`)
  for (const line of describeConfig(config)) console.log(`  ${line}`)
  console.log("")

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (error) {
      throw new Error(`${label}: ${error instanceof Error ? error.message : error}`, {
        cause: error,
      })
    }
  }

  // 1. Deploy the candidate to the canary slot at 0% traffic.
  await run("deploy canary", async () => {
    if (config.deployCmd) {
      const command = config.deployCmd.replaceAll("{image}", config.image ?? "")
      console.log(`  deploying ${config.image} to the canary slot`)
      await execute(command)
    } else {
      console.log(
        "  WARN: SPINDLE_CANARY_DEPLOY_CMD unset; skipping canary deploy " +
          "(router-only mode — make sure the canary workload already runs the image)",
      )
    }
  })

  // 2. Step through weights with gates between stages.
  try {
    for (const weight of config.weights) {
      console.log(`==> stage: ${weight}% of traffic`)
      await setWeight(config, execute, weight)
      await observeStage(config, args.dryRun, weight, run)
      console.log(`    stage ${weight}% passed`)
    }
  } catch (error) {
    console.error(`canary: ${error instanceof Error ? error.message : error}`)
    console.error("canary: gate failed — shifting traffic off the canary")
    await rollbackTraffic(config, execute)
    process.exitCode = 1
    return
  }

  console.log("")
  console.log(
    `Canary stable at ${config.weights.at(-1)}% traffic. ` +
      "Run scripts/deploy/canary/promote.ts to cut over, or rollback.ts to drain.",
  )
}

void main(run)
