import { createResendCooldown } from "@/lib/auth/resend-cooldown"

/**
 * Per-email cooldown for `POST /api/auth/passwordless/request`.
 *
 * The route's IP-based rate limiter alone cannot stop someone from
 * mail-bombing a single victim address through rotating IPs, so every
 * valid request also arms a 60-second window keyed by the submitted email.
 * The window is tracked for *every* well-formed request — known and unknown
 * addresses alike — so the 429 + `retryAfter` response reveals nothing
 * about whether the account exists (same anti-enumeration contract as the
 * `ok` response itself).
 *
 * Kept in its own module (not exported from `route.ts`, which Next.js
 * restricts to HTTP-method exports) so tests can reset the shared instance.
 */
export const MAGIC_LINK_REQUEST_COOLDOWN_SECONDS = 60
export const MAGIC_LINK_REQUEST_COOLDOWN_MS = MAGIC_LINK_REQUEST_COOLDOWN_SECONDS * 1000

export const passwordlessRequestCooldown = createResendCooldown({
  cooldownMs: MAGIC_LINK_REQUEST_COOLDOWN_MS,
})
