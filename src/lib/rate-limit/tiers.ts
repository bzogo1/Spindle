/**
 * Tiered rate-limit model for `/api/*` routes.
 *
 * Two axes:
 *  - **Tier** — who is calling: `anonymous`, `authenticated` (session cookie),
 *    or `apiKey` (reserved for a future public API).
 *  - **Endpoint class** — what the route does: `auth` (credential/session
 *    endpoints), `read`, `write`, `expensive` (aggregation, digest, summary).
 *
 * Every window is per-instance and per-bucket-key, matching the in-memory
 * limiters in `@/lib/site-forms` (`createRateLimiter`) and
 * `./sliding-window` (`createSlidingWindowLimiter`). Values below are derived
 * from the limits currently hard-coded in the `src/app/api` route handlers; see
 * `docs/api/rate-limit-tiers.md` for the full mapping and enforcement points.
 *
 * This module is intentionally pure (no `Request`, no I/O) so it can be unit
 * tested and reused by middleware, route handlers, and edge config generators.
 */

export type RateLimitTier = "anonymous" | "authenticated" | "apiKey"

export type EndpointClass = "auth" | "read" | "write" | "expensive"

export type TierWindow = {
  /** Maximum requests allowed within `windowMs` per bucket key. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * Default limits per tier × endpoint class. These are the *class defaults*;
 * concrete routes should prefer an entry in `ENDPOINT_LIMIT_OVERRIDES` when
 * one exists for their path.
 *
 * Rationale per cell:
 *  - anonymous/auth 10/min  — matches the tightest current auth limiters
 *    (signin, verify-login, 2FA verify, OAuth callback are all 10/min).
 *  - anonymous/read 60/min  — public reads (docs, search) are cheap; health
 *    probes use a per-route override far above this.
 *  - anonymous/write 20/h   — public form writes run 5–30/hour per route
 *    (contact 5/h, newsletter 10/h, feedback 10/h, nps 20/h, unsubscribe
 *    30/h); 20/h is the median, tightened per-route via overrides.
 *  - anonymous/expensive 5/min — unauthenticated callers get almost no
 *    expensive surface; anything real requires a session.
 *  - authenticated/read 240/min — SPA polling (notifications, activity,
 *    profile) plus navigation; ~4 req/s sustained is generous for a human.
 *  - authenticated/write 60/min — settings/profile/preferences edits.
 *  - authenticated/expensive 60/min — matches `/api/analytics/summary` (60/min
 *    per principal), the only expensive authenticated route with a limiter today.
 *  - apiKey/* — reserved for the future public API; starts generous because
 *    keys are issued deliberately, but still bounded per key.
 */
export const RATE_LIMIT_MATRIX: Record<RateLimitTier, Record<EndpointClass, TierWindow>> = {
  anonymous: {
    auth: { limit: 10, windowMs: MINUTE },
    read: { limit: 60, windowMs: MINUTE },
    write: { limit: 20, windowMs: HOUR },
    expensive: { limit: 5, windowMs: MINUTE },
  },
  authenticated: {
    auth: { limit: 30, windowMs: MINUTE },
    read: { limit: 240, windowMs: MINUTE },
    write: { limit: 60, windowMs: MINUTE },
    expensive: { limit: 60, windowMs: MINUTE },
  },
  apiKey: {
    auth: { limit: 60, windowMs: MINUTE },
    read: { limit: 600, windowMs: MINUTE },
    write: { limit: 300, windowMs: MINUTE },
    expensive: { limit: 60, windowMs: MINUTE },
  },
}

/**
 * Per-route limits copied verbatim from the `createRateLimiter({...})` calls
 * in the `src/app/api` route handlers. When a route path appears here it wins over
 * the tier × class default — including for authenticated callers where the
 * route is intentionally keyed differently (e.g. digest by recipient).
 *
 * Keep this table in sync when route limiters change; the doc
 * `docs/api/rate-limit-tiers.md` lists the same values.
 */
export const ENDPOINT_LIMIT_OVERRIDES: Record<string, TierWindow> = {
  // Public forms / feedback (anonymous, per-IP).
  "/api/contact": { limit: 5, windowMs: HOUR },
  "/api/newsletter": { limit: 10, windowMs: HOUR },
  "/api/nps": { limit: 20, windowMs: HOUR },
  "/api/feedback": { limit: 10, windowMs: HOUR },
  // Unsubscribe is split across GET (confirm page) and POST (action); both
  // share the same limiter instance in the route.
  "/api/email/unsubscribe": { limit: 30, windowMs: HOUR },
  // Digest is keyed by recipient address, not IP — see route for details.
  "/api/notifications/digest": { limit: 10, windowMs: HOUR },
  // Analytics: high-volume telemetry ingest plus a per-principal summary.
  "/api/analytics": { limit: 300, windowMs: MINUTE },
  "/api/analytics/summary": { limit: 60, windowMs: MINUTE },
  // Auth endpoints — all anonymous, per-IP (clientIp()).
  "/api/auth/signin": { limit: 10, windowMs: MINUTE },
  "/api/auth/signup": { limit: 5, windowMs: HOUR },
  "/api/auth/passwordless/request": { limit: 5, windowMs: 10 * MINUTE },
  "/api/auth/passwordless/verify": { limit: 10, windowMs: MINUTE },
  "/api/auth/password/reset/request": { limit: 5, windowMs: 10 * MINUTE },
  "/api/auth/password/reset/confirm": { limit: 10, windowMs: 10 * MINUTE },
  "/api/auth/verify-email": { limit: 10, windowMs: 10 * MINUTE },
  "/api/auth/verify-email/resend": { limit: 5, windowMs: 10 * MINUTE },
  "/api/auth/2fa/verify-login": { limit: 10, windowMs: MINUTE },
  "/api/auth/2fa/recovery/request": { limit: 5, windowMs: 10 * MINUTE },
  "/api/auth/2fa/recovery/confirm": { limit: 10, windowMs: MINUTE },
  "/api/auth/2fa/recovery/cancel": { limit: 10, windowMs: MINUTE },
  "/api/auth/oauth/callback": { limit: 10, windowMs: MINUTE },
}

/** What the caller presented, as far as rate limiting is concerned. */
export type RateLimitPrincipal = {
  /** Verified session user id, when the request is authenticated. */
  userId?: string | null
  /** API key id, when the request carries a (future) API key. */
  apiKeyId?: string | null
}

/**
 * Resolves the caller tier. Precedence: an API key outranks a session (a
 * request carrying both is treated as an API client); a session outranks
 * anonymous. Anything else is `anonymous`.
 */
export function resolveTier(principal: RateLimitPrincipal): RateLimitTier {
  if (principal.apiKeyId) return "apiKey"
  if (principal.userId) return "authenticated"
  return "anonymous"
}

/**
 * Resolves the effective window for a request: the per-route override wins,
 * then the tier × class default.
 */
export function resolveLimit(
  tier: RateLimitTier,
  endpointClass: EndpointClass,
  routePath?: string,
): TierWindow {
  if (routePath) {
    const override = ENDPOINT_LIMIT_OVERRIDES[routePath]
    if (override) return override
  }
  return RATE_LIMIT_MATRIX[tier][endpointClass]
}

/**
 * Bucket key for a limiter. Authenticated callers are keyed by user id so a
 * shared office IP does not pool everyone's budget; anonymous callers fall
 * back to the client IP (same precedence as `rateLimitKey` in
 * `./sliding-window`: cf-connecting-ip → x-forwarded-for → "unknown").
 */
export function rateLimitBucketKey(
  tier: RateLimitTier,
  opts: { userId?: string | null; apiKeyId?: string | null; ip?: string | null },
): string {
  if (tier === "apiKey" && opts.apiKeyId) return `key:${opts.apiKeyId}`
  if (tier === "authenticated" && opts.userId) return `user:${opts.userId}`
  const ip = opts.ip?.trim()
  return `ip:${ip || "unknown"}`
}

/**
 * Response headers for a rate-limit decision, following the IETF
 * `RateLimit` header draft: `RateLimit-Limit`, `RateLimit-Remaining`,
 * `RateLimit-Reset` (seconds until the window resets). On a denied request,
 * `Retry-After` (delay-seconds) is added per RFC 9110.
 */
export function rateLimitHeaders(
  decision: { limit: number; remaining: number; resetAt: number | null; retryAfterMs?: number },
  now: number = Date.now(),
): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(Math.max(0, decision.remaining)),
    "RateLimit-Reset":
      decision.resetAt === null
        ? "0"
        : String(Math.max(0, Math.ceil((decision.resetAt - now) / 1000))),
  }
  if (decision.retryAfterMs && decision.retryAfterMs > 0) {
    headers["Retry-After"] = String(Math.ceil(decision.retryAfterMs / 1000))
  }
  return headers
}
