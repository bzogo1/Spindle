/**
 * Sliding-window rate limiter for app-level abuse control.
 *
 * This complements — never replaces — edge rate limiting (Cloudflare rate
 * limiting rules, see `docs/security/edge-rate-limiting.md`). The edge drops
 * volumetric abuse before it reaches the origin; this module protects
 * expensive or sensitive app routes (auth flows, public forms, API endpoints)
 * where the edge rules are too coarse to express the limit.
 *
 * Unlike the fixed-window `createRateLimiter` in `@/lib/site-forms`, this
 * implementation keeps a timestamp log per key and counts requests in the
 * trailing `windowMs`. That eliminates the fixed-window boundary burst (2x
 * `limit` in the worst case) at the cost of O(limit) memory per key.
 *
 * State is per-process: on multi-instance deploys each instance keeps its own
 * counters, so the effective limit is `limit * instances`. Treat this as a
 * per-instance guardrail; a shared store (Valkey/Postgres) is the upgrade path
 * if a hard global guarantee is required.
 */

export type RateLimitDecision = {
  /** True when the request may proceed. */
  allowed: boolean
  /** Requests still permitted in the current window after this check. */
  remaining: number
  /** Configured limit for this window. */
  limit: number
  /** Epoch ms when the oldest counted request leaves the window; `null` when allowed with no pending expiry. */
  resetAt: number | null
  /** Milliseconds until the caller may retry; 0 when allowed. */
  retryAfterMs: number
}

export type SlidingWindowLimiterOptions = {
  /** Maximum requests allowed within `windowMs` per key. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number
  /**
   * Hard cap on tracked keys. When exceeded, expired buckets are swept; if the
   * map is still full, the least-recently-updated buckets are evicted. Bounds
   * memory against key-spam attacks (each unique IP/key gets an entry).
   * Default: 10_000.
   */
  maxKeys?: number
}

export type SlidingWindowLimiter = {
  /**
   * Records one request for `key` and returns the decision.
   * Always call once per request; do not call `peek` and then `check` for the
   * same request.
   */
  check(key: string): RateLimitDecision
  /** Number of keys with at least one unexpired hit. */
  size(): number
}

type Bucket = {
  /** Ascending request timestamps (ms) still inside the window. */
  hits: number[]
  /** Last `check` time for this key; used for LRU eviction order. */
  touchedAt: number
}

const DEFAULT_MAX_KEYS = 10_000

export function createSlidingWindowLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
  maxKeys = DEFAULT_MAX_KEYS,
}: SlidingWindowLimiterOptions): SlidingWindowLimiter {
  const buckets = new Map<string, Bucket>()

  function evictExpired(at: number) {
    const cutoff = at - windowMs
    for (const [key, bucket] of buckets) {
      while (bucket.hits.length > 0 && bucket.hits[0]! <= cutoff) bucket.hits.shift()
      if (bucket.hits.length === 0) buckets.delete(key)
    }
  }

  /** LRU-ish eviction: evict least-recently-touched keys until a slot is free. */
  function evictOverflow() {
    // Reinsert in touchedAt order so oldest-touched keys are evicted first.
    // Evict down to maxKeys - 1 so the pending insert lands at exactly maxKeys.
    const ordered = [...buckets.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    for (const [key] of ordered) {
      if (buckets.size < maxKeys) break
      buckets.delete(key)
    }
  }

  return {
    check(key: string) {
      const at = now()
      const cutoff = at - windowMs

      let bucket = buckets.get(key)
      if (!bucket) {
        if (buckets.size >= maxKeys) {
          evictExpired(at)
          if (buckets.size >= maxKeys) evictOverflow()
        }
        bucket = { hits: [], touchedAt: at }
        buckets.set(key, bucket)
      }

      while (bucket.hits.length > 0 && bucket.hits[0]! <= cutoff) bucket.hits.shift()
      bucket.touchedAt = at

      if (bucket.hits.length >= limit) {
        const oldest = bucket.hits[0]!
        const resetAt = oldest + windowMs
        return {
          allowed: false,
          remaining: 0,
          limit,
          resetAt,
          retryAfterMs: Math.max(0, resetAt - at),
        }
      }

      bucket.hits.push(at)
      const resetAt = bucket.hits[0]! + windowMs
      return {
        allowed: true,
        remaining: limit - bucket.hits.length,
        limit,
        resetAt,
        retryAfterMs: 0,
      }
    },
    size() {
      const at = now()
      const cutoff = at - windowMs
      let count = 0
      for (const bucket of buckets.values()) {
        // Count only buckets that would survive a sweep.
        const first = bucket.hits[0]
        if (first !== undefined && first > cutoff) count += 1
      }
      return count
    },
  }
}

/**
 * Resolves the bucket key for a request.
 *
 * Precedence:
 *  1. `apiKey` — when provided and the request carries an API key (or any
 *     configured credential header), callers should pass it explicitly; this
 *     helper only handles the anonymous/IP tier. Per-API-key limiting is the
 *     caller's job once the key is authenticated.
 *  2. `cf-connecting-ip` — set by Cloudflare on every proxied request; the
 *     most trustworthy source behind the tunnel.
 *  3. First `x-forwarded-for` hop — fallback for direct-to-origin requests
 *     (staging, local dev, the nginx fallback layer).
 *  4. `"unknown"` — single shared bucket when no forwarding headers exist.
 *     Prefer this over trusting `request.ip`-style fields, which are
 *     client-controllable at the app layer.
 */
export function rateLimitKey(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return `ip:${cfIp}`

  const forwarded = request.headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  if (first) return `ip:${first}`

  return "ip:unknown"
}

/**
 * Standard limit tiers. Values are per-instance, per-window starting points;
 * tune against observed traffic before tightening.
 */
export const RATE_LIMIT_TIERS = {
  /** Public site forms (contact, newsletter). Tight: humans submit rarely. */
  form: { limit: 5, windowMs: 10 * 60 * 1000 },
  /** Auth-adjacent endpoints (verify-email resend, magic link, 2FA verify). */
  auth: { limit: 10, windowMs: 60 * 1000 },
  /** Authenticated API routes: generous enough for normal SPA usage. */
  api: { limit: 120, windowMs: 60 * 1000 },
  /** Unauthenticated API routes and webhooks-adjacent surfaces. */
  apiPublic: { limit: 30, windowMs: 60 * 1000 },
  /** Health/readiness probes: effectively unlimited, kept for completeness. */
  health: { limit: 600, windowMs: 60 * 1000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>
