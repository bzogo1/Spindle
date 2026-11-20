import { fail } from "@/lib/auth/http"
import { createResendCooldown, type ResendCooldown } from "@/lib/auth/resend-cooldown"
import { clientIp, createRateLimiter, type RateLimiter } from "@/lib/site-forms"

/**
 * Shared rate limiting for `/api/auth/*` endpoints.
 *
 * The underlying primitive is the fixed-window `createRateLimiter` from
 * `@/lib/site-forms` (per-process, best-effort — see its docs for the
 * multi-instance caveat). This module only standardises *which* limits auth
 * endpoints use so every route applies the same tiers instead of picking
 * ad-hoc numbers:
 *
 *  - `emailSend`     — endpoints that trigger outbound email (magic links,
 *                      verification resends, password-reset requests).
 *                      Tightest per-IP budget; values match the limiters
 *                      that already shipped on those routes.
 *  - `tokenConsume`  — single-use token consumption where guessing is the
 *                      threat (email verification, password reset confirm).
 *  - `tokenConsumeFast` — same threat model but a shorter window, for
 *                      high-frequency token checks (magic-link verify, OAuth
 *                      code exchange).
 *  - `publicRead`    — read-only public endpoints (provider config, the
 *                      mock-OAuth authorize bounce). Lenient: these are hit
 *                      during normal sign-in UI flows.
 *
 * Per-email cooldowns (`createResendCooldown`) complement the per-IP
 * limiters on email-sending endpoints: they must be applied uniformly to
 * known and unknown addresses alike so the 429 cannot become an
 * account-enumeration oracle.
 */
export const AUTH_LIMITS = {
  emailSend: { limit: 5, windowMs: 10 * 60 * 1000 },
  tokenConsume: { limit: 10, windowMs: 10 * 60 * 1000 },
  tokenConsumeFast: { limit: 10, windowMs: 60 * 1000 },
  publicRead: { limit: 60, windowMs: 60 * 1000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>

export type AuthLimitPreset = keyof typeof AUTH_LIMITS

export type AuthLimitWindow = (typeof AUTH_LIMITS)[AuthLimitPreset]

/**
 * Creates a per-IP limiter for an auth endpoint. Accepts either a preset
 * name (`"emailSend"`) or the preset object itself (`AUTH_LIMITS.emailSend`).
 */
export function createAuthRateLimiter(
  preset: AuthLimitPreset | AuthLimitWindow,
  now?: () => number,
): RateLimiter {
  const window = typeof preset === "string" ? AUTH_LIMITS[preset] : preset
  return createRateLimiter({ limit: window.limit, windowMs: window.windowMs, now })
}

/** First `x-forwarded-for` hop, re-exported for one-stop auth imports. */
export { clientIp }
export type { RateLimiter }

/**
 * Standard 429 envelope for auth endpoints. Routes that need a `retryAfter`
 * (per-email cooldowns) build their own `fail(...)` response instead.
 */
export function authRateLimited() {
  return fail(429, "rate_limited", "Too many attempts. Try again later.")
}

/** Cooldown between password-reset emails to the same address. */
export const PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS = 60
export const PASSWORD_RESET_REQUEST_COOLDOWN_MS = PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS * 1000

/**
 * Shared per-email cooldown for `POST /api/auth/password/reset/request`.
 * Module-level like the in-memory auth backend — per-process, reset between
 * tests via `.reset()`.
 */
export const passwordResetRequestCooldown: ResendCooldown = createResendCooldown({
  cooldownMs: PASSWORD_RESET_REQUEST_COOLDOWN_MS,
})
