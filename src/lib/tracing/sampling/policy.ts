/**
 * Trace sampling policy — pure, framework-agnostic decision functions.
 *
 * Sentry's `tracesSampleRate` accepts a single global ratio, which is too
 * coarse for an app whose routes have wildly different traffic and
 * diagnostic value. `tracesSampler` hands the sampler a context object
 * (transaction name, attributes, parent-sample state) and expects a rate
 * back; these helpers turn a declarative {@link SamplingPolicy} into that
 * decision while staying 100% testable — no Sentry import, no globals.
 *
 * The pieces:
 *
 * - {@link decideTraceSample} — the entry point Sentry calls. Returns a
 *   0..1 rate AND a boolean decision, computed deterministically from the
 *   trace id (or transaction name as fallback) so the same trace always
 *   gets the same answer and re-sampled spans agree.
 * - {@link resolveRate} — pure rule evaluation: error bias first, then
 *   ordered per-route rules, then the default rate.
 * - {@link ForcedKeepRule} — "tail-based" keeps. At `tracesSampler` time a
 *   trace's duration/error count is not yet known, so these only fire when
 *   the caller supplies the signals (e.g. attributes propagated through
 *   `sentry-trace` headers, or a post-hoc `beforeSendTransaction` pass).
 *   See docs/observability/trace-sampling.md for the head-vs-tail tradeoff.
 *
 * Wiring (documented, NOT applied — the Sentry config files are owned
 * elsewhere) lives in docs/observability/trace-sampling.md.
 */

/** Minimal context shape — mirrors what Sentry passes to `tracesSampler`. */
export interface TraceSampleContext {
  /** Transaction name, e.g. "GET /api/projects" or "/docs/[slug]". */
  transactionName: string
  /** Stable id used for deterministic sampling. Falls back to the name. */
  traceId?: string
  /** Free-form span/transaction attributes propagated from the parent. */
  attributes?: Record<string, unknown>
  /** Transaction tags (e.g. `error`, `http.status_code`). */
  tags?: Record<string, string | undefined>
  /** Known-up-front error signal. Rarely known at sample time. */
  hasError?: boolean
  /** Known-up-front duration — only when propagated from a parent trace. */
  durationMs?: number
}

export interface SamplingRule {
  /** Human-readable identifier, surfaced in the decision reason. */
  name: string
  /** First matching rule wins; rules are evaluated in array order. */
  rate: number
  match: (ctx: TraceSampleContext) => boolean
}

/** A "tail-based" keep: force-sample when a condition on trace outcome is met. */
export interface ForcedKeepRule {
  name: string
  reason: string
  when: (ctx: TraceSampleContext) => boolean
}

export interface SamplingPolicy {
  /** Fallback rate when no rule matches. Clamped to [0, 1]. */
  defaultRate: number
  /**
   * Rate used when the context carries an error signal (`hasError` or an
   * `error`/`http.status_code >= 500` tag). Defaults to 1 — errors are the
   * highest-value traces and are cheap to keep.
   */
  errorRate: number
  /** Ordered per-route / per-transaction rules. */
  rules: SamplingRule[]
  /** Tail-based keeps, evaluated before the ratio decision. */
  forcedKeeps: ForcedKeepRule[]
}

export interface RateResolution {
  rate: number
  /** Which branch produced the rate: "error" | rule name | "default". */
  source: string
}

export interface SampleDecision extends RateResolution {
  /** Deterministic boolean: hash(traceId ?? name) < rate. */
  sample: boolean
  /** Human-readable explanation for logs/debugging. */
  reason: string
  /** Set when a forced keep overrode the ratio decision. */
  forcedBy?: string
}

const clamp01 = (rate: number) => Math.min(1, Math.max(0, rate))

/**
 * FNV-1a 32-bit hash → [0, 1). Deterministic across processes and runs,
 * which is what makes repeated sampling decisions for the same trace
 * consistent (Sentry's own sampler does the same per-trace-id).
 */
export function hashToUnit(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  // >>> 0 normalizes to unsigned 32-bit.
  return (hash >>> 0) / 0x1_0000_0000
}

function hasErrorSignal(ctx: TraceSampleContext): boolean {
  if (ctx.hasError) return true
  const errorTag = ctx.tags?.error
  if (errorTag === "true" || errorTag === "1") return true
  const status = ctx.tags?.["http.status_code"] ?? ctx.attributes?.["http.status_code"]
  const code = typeof status === "string" ? Number(status) : status
  return typeof code === "number" && code >= 500
}

/**
 * Resolve the effective sample rate for a context. Error bias wins first,
 * then the first matching rule, then the default.
 */
export function resolveRate(ctx: TraceSampleContext, policy: SamplingPolicy): RateResolution {
  if (hasErrorSignal(ctx)) {
    return { rate: clamp01(policy.errorRate), source: "error" }
  }
  for (const rule of policy.rules) {
    if (rule.match(ctx)) {
      return { rate: clamp01(rule.rate), source: rule.name }
    }
  }
  return { rate: clamp01(policy.defaultRate), source: "default" }
}

/**
 * Full sampling decision: forced keeps (tail-based) → error/rule/default
 * rate → deterministic hash comparison.
 */
export function decideTraceSample(ctx: TraceSampleContext, policy: SamplingPolicy): SampleDecision {
  for (const keep of policy.forcedKeeps) {
    if (keep.when(ctx)) {
      return {
        sample: true,
        rate: 1,
        source: `forced:${keep.name}`,
        forcedBy: keep.name,
        reason: `forced keep: ${keep.reason}`,
      }
    }
  }

  const { rate, source } = resolveRate(ctx, policy)
  const key = ctx.traceId ?? ctx.transactionName
  const sample = hashToUnit(key) < rate
  return {
    sample,
    rate,
    source,
    reason: sample ? `kept at rate ${rate} (${source})` : `dropped at rate ${rate} (${source})`,
  }
}

/**
 * Convert a glob-ish route pattern into a matcher for transaction names.
 * `*` matches within a path segment, `**` matches across segments. Patterns
 * are matched against the full transaction name, so callers should include
 * the method prefix when relevant (e.g. "GET /api/**").
 */
export function routePattern(pattern: string): (ctx: TraceSampleContext) => boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\uE000")
    .replace(/\*/g, "[^/]*")
    .replace(/\uE000/g, ".*")
  const re = new RegExp(`^${escaped}$`)
  return (ctx) => re.test(ctx.transactionName)
}

/** Convenience builder for per-route ratio rules. */
export function routeRule(patterns: string[], rate: number, name: string): SamplingRule {
  const matchers = patterns.map(routePattern)
  return {
    name,
    rate,
    match: (ctx) => matchers.some((m) => m(ctx)),
  }
}

/** Forced-keep builder keyed on minimum known duration. */
export function durationKeepRule(
  name: string,
  minDurationMs: number,
  reason: string,
): ForcedKeepRule {
  return {
    name,
    reason,
    when: (ctx) => typeof ctx.durationMs === "number" && ctx.durationMs >= minDurationMs,
  }
}

/** Forced-keep builder keyed on a transaction tag value. */
export function tagKeepRule(
  name: string,
  tag: string,
  value: string,
  reason: string,
): ForcedKeepRule {
  return {
    name,
    reason,
    when: (ctx) => ctx.tags?.[tag] === value,
  }
}

/**
 * Recommended starting policy for this app. Marketing/docs pages are cheap
 * to keep at a modest rate; app routes carry the real signal; API routes
 * are high-volume and get the lowest ratio. Tune against actual quota —
 * see docs/observability/trace-sampling.md.
 */
export function recommendedPolicy(overrides: Partial<SamplingPolicy> = {}): SamplingPolicy {
  return {
    defaultRate: 0.05,
    errorRate: 1,
    rules: [
      // Page transactions are named by route path ("/projects"), server
      // transactions by "METHOD /path" — cover both shapes.
      routeRule(["GET /api/**"], 0.02, "api-low-volume"),
      routeRule(["/app/**", "/projects/**", "/settings/**", "POST /api/**"], 0.15, "app-routes"),
      routeRule(["/", "/pricing", "/docs/**", "/blog/**"], 0.1, "marketing-docs"),
      routeRule(["/_next/**", "*/_next/**"], 0, "static-assets"),
    ],
    forcedKeeps: [
      durationKeepRule("slow-trace", 5_000, "trace exceeded 5s — likely user-visible pain"),
      tagKeepRule("checkout-flow", "flow", "checkout", "business-critical funnel"),
    ],
    ...overrides,
  }
}
