import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { issueCaptchaChallenge } from "@/lib/captcha"
import { createAuthRateLimiter, clientIp } from "@/lib/auth-endpoint-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter("publicRead")

/**
 * GET /api/auth/captcha — issues a proof-of-work challenge for the client to
 * solve. The response carries everything the widget needs: the `prefix` to
 * hash, the required `difficulty` (leading zero bits), and the challenge id
 * to submit back to `POST /api/auth/captcha`.
 */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const challenge = issueCaptchaChallenge()
  return ok({
    challengeId: challenge.challengeId,
    prefix: challenge.prefix,
    difficulty: challenge.difficulty,
    expiresAt: challenge.expiresAt,
  })
}
