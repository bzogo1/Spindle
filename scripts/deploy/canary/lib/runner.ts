/**
 * Shared CLI plumbing for the canary scripts: argument parsing, environment
 * resolution, command execution, and the smoke-test gate.
 *
 * `env` is imported from node:process rather than read as `process.env` so
 * the entrypoints stay inside the repo's lint rules without touching the
 * shared eslint allowlist; env access stays confined to this file.
 */

import { exec } from "node:child_process"
import { promisify } from "node:util"
import { env } from "node:process"

import type { CanaryConfig, CanaryConfigOverrides, EnvSource } from "./config"
import { createMetricsSource, evaluateMetricGate } from "./metrics"

const execAsync = promisify(exec)

export interface CliArgs {
  dryRun: boolean
  overrides: CanaryConfigOverrides
  /** Extra positional/flag values not consumed by the shared parser. */
  rest: string[]
}

/**
 * Parses the flags every canary subcommand accepts:
 *   --dry-run                 print the plan; run no docker/network commands
 *   --image <ref>             override SPINDLE_CANARY_IMAGE
 *   --weights <csv>           override SPINDLE_CANARY_WEIGHTS (e.g. "5,25,50")
 *   --stage-seconds <n>       override SPINDLE_CANARY_STAGE_SECONDS
 *   -- <args>                 everything after `--` lands in `rest`
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, overrides: {}, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) throw new Error(`${arg} requires a value`)
      return value
    }
    switch (arg) {
      case "--dry-run":
        args.dryRun = true
        break
      case "--image":
        args.overrides.image = next()
        break
      case "--weights": {
        const parts = next()
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
        if (parts.length === 0) {
          throw new Error("--weights requires at least one weight")
        }
        args.overrides.weights = parts.map((part) => {
          const value = Number(part)
          if (!Number.isFinite(value)) {
            throw new Error(`Invalid canary weight "${part}" in --weights`)
          }
          return value
        })
        break
      }
      case "--stage-seconds": {
        const value = Number(next())
        if (!Number.isFinite(value) || value < 0) {
          throw new Error("--stage-seconds must be a non-negative number")
        }
        args.overrides.stageSeconds = value
        break
      }
      case "--":
        args.rest = argv.slice(i + 1)
        return args
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`)
        args.rest.push(arg)
    }
  }
  return args
}

/** Resolves the environment for config parsing. Isolated for tests. */
export function canaryEnv(): EnvSource {
  return env
}

export type Executor = (command: string) => Promise<void>

/** Runs a shell command for real. */
export const shellExecutor: Executor = async (command) => {
  await execAsync(command)
}

/** Prints what would run; performs no docker or network calls. */
export const dryRunExecutor: Executor = async (command) => {
  console.log(`  [dry-run] $ ${command}`)
}

export function executorFor(dryRun: boolean): Executor {
  return dryRun ? dryRunExecutor : shellExecutor
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Substitutes {weight} in a router command template. */
export function renderRouterCommand(template: string, weight: number): string {
  if (!template.includes("{weight}")) {
    throw new Error(`Router command must contain a {weight} placeholder: ${template}`)
  }
  return template.replaceAll("{weight}", String(weight))
}

/**
 * Runs one rollout step, honoring --dry-run for sleeps and network probes.
 * In dry-run mode stage waits and smoke/metrics checks are reported but not
 * performed, so a rollout plan can be reviewed locally in milliseconds.
 */
export async function observeStage(
  config: CanaryConfig,
  dryRun: boolean,
  weight: number,
  run: (label: string, fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  if (config.stageSeconds > 0) {
    if (dryRun) {
      console.log(`  [dry-run] would observe weight ${weight}% for ${config.stageSeconds}s`)
    } else {
      console.log(`  observing weight ${weight}% for ${config.stageSeconds}s…`)
      await sleep(config.stageSeconds * 1000)
    }
  }
  await run(`smoke gate @ ${weight}%`, async () => {
    if (dryRun) {
      console.log(`  [dry-run] would poll ${config.smokeUrl ?? "<no SPINDLE_CANARY_SMOKE_URL>"}`)
      return
    }
    await smokeGate(config)
  })
  await run(`metric gate @ ${weight}%`, async () => {
    if (dryRun) {
      console.log("  [dry-run] would evaluate metric thresholds")
      return
    }
    await metricGate(config)
  })
}

/**
 * Polls the smoke URL until it returns a 2xx response or attempts run out.
 * Skipped (with a warning) when no URL is configured.
 */
export async function smokeGate(config: CanaryConfig): Promise<void> {
  if (!config.smokeUrl) {
    console.warn("  WARN: SPINDLE_CANARY_SMOKE_URL unset; smoke gate skipped")
    return
  }
  let lastError = "no attempts made"
  for (let attempt = 1; attempt <= config.smokeAttempts; attempt++) {
    try {
      const response = await fetch(config.smokeUrl, {
        signal: AbortSignal.timeout(config.smokeTimeoutMs),
        redirect: "follow",
      })
      if (response.ok) {
        console.log(`  smoke OK: ${config.smokeUrl} -> HTTP ${response.status}`)
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (attempt < config.smokeAttempts) {
      await sleep(config.smokeIntervalMs)
    }
  }
  throw new Error(
    `Smoke gate failed: ${config.smokeUrl} did not return 2xx after ` +
      `${config.smokeAttempts} attempts (last: ${lastError})`,
  )
}

/**
 * Samples the metrics source across the stage window and evaluates the
 * configured thresholds on the final window. With no metrics URL the gate is
 * skipped unless SPINDLE_CANARY_REQUIRE_METRICS=1.
 */
export async function metricGate(config: CanaryConfig): Promise<void> {
  const source = createMetricsSource(config)

  if (source.name === "none" && !config.requireMetrics) {
    console.warn(
      "  WARN: SPINDLE_CANARY_METRICS_URL unset; metric gate skipped " +
        "(set REQUIRE_METRICS=1 to make this fatal)",
    )
    return
  }

  const windowSeconds = Math.max(config.stageSeconds, Math.ceil(config.metricsPollMs / 1000))
  const deadline = Date.now() + windowSeconds * 1000
  let result = evaluateMetricGate(config, await source.windowStats(windowSeconds))

  // Keep sampling until the window closes; a late-blooming window may cross
  // minRequests only after more traffic has accumulated.
  while (!result.pass && Date.now() < deadline) {
    await sleep(config.metricsPollMs)
    result = evaluateMetricGate(config, await source.windowStats(windowSeconds))
  }

  const stats = result.window
  console.log(
    `  metrics (${source.name}): requests=${stats?.requests ?? "?"} ` +
      `errorRate=${stats ? `${(stats.errorRate * 100).toFixed(2)}%` : "?"} ` +
      `p95=${stats ? `${stats.p95LatencyMs.toFixed(0)}ms` : "?"}`,
  )

  if (!result.pass) {
    throw new Error(`Metric gate failed: ${result.reasons.join("; ")}`)
  }
}

/** Standard entrypoint wrapper: errors print to stderr and exit non-zero. */
export async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.error(`canary: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

/** Prints the resolved configuration for `status` and dry-run review. */
export function describeConfig(config: CanaryConfig): string[] {
  const lines = [
    `image:            ${config.image ?? "<unset SPINDLE_CANARY_IMAGE>"}`,
    `weights:          ${config.weights.join(" -> ")}%`,
    `stageSeconds:     ${config.stageSeconds}`,
    `routerCmd:        ${config.routerCmd ?? "<unset — canary gets no traffic>"}`,
    `deployCmd:        ${config.deployCmd ?? "<unset>"}`,
    `promoteCmd:       ${config.promoteCmd ?? "<unset>"}`,
    `rollbackCmd:      ${config.rollbackCmd ?? "<unset>"}`,
    `statusCmd:        ${config.statusCmd ?? "<unset>"}`,
    `smokeUrl:         ${config.smokeUrl ?? "<unset — smoke gate skipped>"}`,
    `metricsUrl:       ${config.metricsUrl ?? "<unset — metric gate skipped>"}`,
    `requireMetrics:   ${config.requireMetrics}`,
    `gates:            errorRate<=${(config.maxErrorRate * 100).toFixed(2)}% ` +
      `p95<=${config.maxP95LatencyMs}ms requests>=${config.minRequests}`,
  ]
  return lines
}
