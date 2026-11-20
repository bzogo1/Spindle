import { getAuthBackend } from "@/lib/auth/backend"
import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { tokenSchema } from "@/lib/auth/schemas"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

/**
 * POST /api/auth/verify-email — consumes a verification token and marks the
 * account verified. Single-use; all failures return the same 401.
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
  const consumed = await backend.consumeOneTimeToken(parsed.data.token, "verify")
  if (!consumed.ok) {
    const messages = {
      expired: "This verification link has expired.",
      used: "This verification link has already been used.",
      invalid: "This verification link isn't valid.",
    } as const
    return fail(401, "invalid_token", messages[consumed.reason], { reason: consumed.reason })
  }
  const record = consumed.record
  const userId = record.userId ?? (await backend.getUserByEmail(record.email))?.id
  if (!userId) {
    return fail(401, "invalid_token", "This verification link isn't valid.", {
      reason: "invalid",
    })
  }

  await backend.markEmailVerified(userId)
  return ok({ verified: true })
}
