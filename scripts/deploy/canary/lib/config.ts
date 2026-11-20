/**
 * Canary rollout configuration.
 *
 * All values come from `SPINDLE_CANARY_*` environment variables (or the
 * equivalent `--flag` overrides parsed in lib/runner.ts). Nothing here reads
 * secrets: the canary inherits the app's normal secret path at container
 * start, exactly like the stable service.
 *
 * Traffic splitting is delegated to whatever edge/router the operator
 * configures through SPINDLE_CANARY_ROUTER_CMD (a command template containing
 * `{weight}`). The scripts never assume a specific router — Cloudflare Load
 * Balancing, a weighted Caddy `reverse_proxy`, or a service mesh all fit the
 * same contract.
 */

/** Same shape as src/lib/env.ts EnvSource; kept local so scripts stay standalone. */
export type EnvSource = Record<string, string | undefined>

export interface CanaryConfig {
  /** Container image ref for the canary deployment. Required by `deploy`. */
  image?: string
  /**
   * Ordered traffic weights (percent, 0–100) the rollout steps through.
   * Each stage is observed for `stageSeconds` before advancing.
   */
  weights: number[]
  /** Seconds to observe metrics at each weight stage. */
  stageSeconds: number
  /**
   * Command template that shifts traffic. Must contain `{weight}`.
   * When unset the canary is deployed but receives no production traffic —
   * useful for pre-prod validation only.
   */
  routerCmd?: string
  /** Command that (re)deploys the canary workload with the candidate image. */
  deployCmd?: string
  /** Command that promotes the canary to full traffic. */
  promoteCmd?: string
  /** Command that rolls traffic back off the canary. */
  rollbackCmd?: string
  /** Optional status probe command; its stdout is shown by `status`. */
  statusCmd?: string
  /** Health endpoint polled by the smoke gate after each stage. */
  smokeUrl?: string
  smokeAttempts: number
  smokeIntervalMs: number
  smokeTimeoutMs: number
  /** Metrics endpoint returning a MetricsWindow JSON document. */
  metricsUrl?: string
  /**
   * When true, a missing metrics source fails the gate instead of skipping
   * it. Defaults to false so the stubbed collector never blocks a rollout.
   */
  requireMetrics: boolean
  /** Metric gate thresholds applied to each observation window. */
  maxErrorRate: number
  maxP95LatencyMs: number
  minRequests: number
  /** Metrics poll cadence inside a stage window. */
  metricsPollMs: number
}

export interface CanaryConfigOverrides {
  image?: string
  weights?: number[]
  stageSeconds?: number
}

function readString(source: EnvSource, key: string): string | undefined {
  const value = source[`SPINDLE_CANARY_${key}`]
  return value && value.length > 0 ? value : undefined
}

function readNumber(source: EnvSource, key: string, fallback: number): number {
  const raw = readString(source, key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`SPINDLE_CANARY_${key} must be a number, got "${raw}"`)
  }
  return value
}

function readBoolean(source: EnvSource, key: string, fallback: boolean): boolean {
  const raw = readString(source, key)
  if (raw === undefined) return fallback
  if (raw === "1" || raw === "true") return true
  if (raw === "0" || raw === "false") return false
  throw new Error(`SPINDLE_CANARY_${key} must be 1/0 or true/false, got "${raw}"`)
}

function parseWeights(raw: string | undefined): number[] {
  if (raw === undefined) return [5, 25]
  const weights = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const value = Number(part)
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`Invalid canary weight "${part}" in SPINDLE_CANARY_WEIGHTS`)
      }
      return value
    })
  if (weights.length === 0) {
    throw new Error("SPINDLE_CANARY_WEIGHTS must list at least one weight")
  }
  return weights
}

export function readCanaryConfig(
  source: EnvSource,
  overrides: CanaryConfigOverrides = {},
): CanaryConfig {
  const weights = overrides.weights ?? parseWeights(readString(source, "WEIGHTS"))
  if (weights.length === 0) {
    throw new Error("Canary weights must list at least one stage")
  }
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new Error(`Invalid canary weight ${weight}; weights must be 0–100`)
    }
  }
  return {
    image: overrides.image ?? readString(source, "IMAGE"),
    weights,
    stageSeconds: overrides.stageSeconds ?? readNumber(source, "STAGE_SECONDS", 300),
    routerCmd: readString(source, "ROUTER_CMD"),
    deployCmd: readString(source, "DEPLOY_CMD"),
    promoteCmd: readString(source, "PROMOTE_CMD"),
    rollbackCmd: readString(source, "ROLLBACK_CMD"),
    statusCmd: readString(source, "STATUS_CMD"),
    smokeUrl: readString(source, "SMOKE_URL"),
    smokeAttempts: readNumber(source, "SMOKE_ATTEMPTS", 10),
    smokeIntervalMs: readNumber(source, "SMOKE_INTERVAL_MS", 5_000),
    smokeTimeoutMs: readNumber(source, "SMOKE_TIMEOUT_MS", 10_000),
    metricsUrl: readString(source, "METRICS_URL"),
    requireMetrics: readBoolean(source, "REQUIRE_METRICS", false),
    maxErrorRate: readNumber(source, "MAX_ERROR_RATE", 0.01),
    maxP95LatencyMs: readNumber(source, "MAX_P95_MS", 800),
    minRequests: readNumber(source, "MIN_REQUESTS", 100),
    metricsPollMs: readNumber(source, "METRICS_POLL_MS", 30_000),
  }
}
