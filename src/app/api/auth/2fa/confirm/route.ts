import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { totpCodeSchema } from "@/lib/auth/schemas"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/2fa/confirm — activates TOTP after a valid code and returns
 * the backup codes exactly once. Re-enrolling later rotates both secret and
 * backup codes.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const parsed = totpCodeSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Enter the 6-digit code.")

  const codes = await getAuthBackend().confirmTotpEnrollment(access.uid, parsed.data.code)
  if (!codes) return fail(401, "totp_invalid", "That code didn't match. Try again.")

  return ok({ enabled: true, backupCodes: codes })
}
