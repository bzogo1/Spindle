import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { createCaptchaToken, verifyCaptchaSolution } from "@/lib/captcha"
import { createAuthRateLimiter, clientIp } from "@/lib/auth-endpoint-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter("tokenConsumeFast")

/**
 * POST /api/auth/captcha/verify — verifies a solved proof-of-work challenge
 * (`{ challengeId, nonce }`) and mints a short-lived HMAC-signed captcha
 * token. Challenges are single-use and expire after 5 minutes; failures burn
 * attempts so nonce-guessing cannot run unbounded.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }

  const input = (body ?? {}) as Record<string, unknown>
  const solved = verifyCaptchaSolution({ challengeId: input.challengeId, nonce: input.nonce })
  if (!solved) {
    return fail(403, "captcha_failed", "Security check failed. Please try again.")
  }

  const { token, expiresAt } = createCaptchaToken(String(input.challengeId))
  return ok({ token, expiresAt: expiresAt.toISOString() })
}
