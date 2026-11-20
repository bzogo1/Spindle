/**
 * Trace sampling configuration helpers.
 *
 * Sampling is currently fixed in the Sentry init files
 * (`src/sentry.server.config.ts`, `src/sentry.edge.config.ts`,
 * `src/instrumentation-client.ts`) at a flat `tracesSampleRate` of 0.1,
 * overridable via `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`. This module does
 * NOT change that wiring — it centralizes the constant and provides a pure
 * `tracesSampler` factory for future per-transaction sampling (e.g. always
 * sample errors or low-traffic routes, drop health checks).
 */

/** Mirrors `DEFAULT_TRACES_SAMPLE_RATE` in the Sentry init files. Keep in
 * sync if the init default changes. */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1

/** Env var that overrides the sample rate in all three runtimes. */
export const TRACES_SAMPLE_RATE_ENV = "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE"

/**
 * Parses a sample-rate env value. Accepts numbers in [0, 1] and percentage
 * strings like "10" meaning 10%. Returns `undefined` for missing/invalid
 * input so callers can fall back to the default.
 */
export function parseSampleRate(value: string | null | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined

  const trimmed = value.trim()
  const isPercent = trimmed.endsWith("%")
  const numeric = Number(isPercent ? trimmed.slice(0, -1) : trimmed)

  if (Number.isFinite(numeric)) {
    const rate = isPercent ? numeric / 100 : numeric
    return rate >= 0 && rate <= 1 ? rate : undefined
  }

  return undefined
}

/** Resolves the effective sample rate: env override wins, else the default. */
export function resolveTracesSampleRate(envValue?: string | null): number {
  return parseSampleRate(envValue) ?? DEFAULT_TRACES_SAMPLE_RATE
}

export type SamplerContext = {
  /** Transaction name, e.g. `GET /api/projects/[id]` or `pageload`. */
  name?: string
  /** Whether the transaction carries an error (sampled unconditionally by
   * most policies). */
  hasError?: boolean
  /** Whether the request came from a health-check / synthetic probe. */
  isHealthCheck?: boolean
}

/**
 * A `tracesSampler`-compatible function: returns the sample rate (0–1) for a
 * given transaction. Intended to replace the flat `tracesSampleRate` in the
 * Sentry init files *if* finer control is ever needed — today it is exported
 * for use in tests and future config, not wired anywhere.
 *
 * Policy: health checks and synthetic probes are dropped; transactions with
 * errors are always sampled; everything else uses the resolved base rate.
 */
export function makeTracesSampler(baseRate: number = DEFAULT_TRACES_SAMPLE_RATE) {
  return function tracesSampler(context: SamplerContext): number {
    if (context.isHealthCheck) return 0
    if (context.hasError) return 1
    return baseRate
  }
}
