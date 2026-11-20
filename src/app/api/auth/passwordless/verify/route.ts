import { getAuthBackend } from "@/lib/auth/backend"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import { tokenSchema } from "@/lib/auth/schemas"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

/**
 * POST /api/auth/passwordless/verify — consumes a magic-link token and sets
 * the session cookies. Single-use. All failures share the 401
 * `invalid_token` code, but the `reason` field distinguishes expired /
 * already-used / invalid links so the UI can offer a targeted resend flow
 * (same contract as `/api/auth/verify-email`).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = tokenSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Invalid request body.")

  const backend = getAuthBackend()
  const consumed = await backend.consumeOneTimeToken(parsed.data.token, "magic")
  if (!consumed.ok) {
    const messages = {
      expired: "This sign-in link has expired.",
      used: "This sign-in link has already been used.",
      invalid: "This sign-in link isn't valid.",
    } as const
    return fail(401, "invalid_token", messages[consumed.reason], {
      reason: consumed.reason,
    })
  }

  const user = consumed.record.userId ? await backend.getUserById(consumed.record.userId) : null
  if (!user) {
    return fail(401, "invalid_token", "This sign-in link isn't valid.", {
      reason: "invalid",
    })
  }

  const tokens = await backend.createSessionForUser(user.id)
  evaluateSuccessfulSignIn({
    userId: user.id,
    email: user.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  logger.info({ event: "auth.passwordless.signin", userId: user.id }, "Magic-link sign-in.")
  // The response carries the new session and sets auth cookies; keep it out
  // of shared/browser caches.
  const response = ok({ session: tokens.session })
  response.headers.set("cache-control", "no-store")
  return applyAuthCookies(response, tokens, { remember: true })
}
