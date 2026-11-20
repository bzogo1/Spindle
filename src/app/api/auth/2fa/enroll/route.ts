import { getAuthBackend } from "@/lib/auth/backend"
import { clearUserBackupCodes } from "@/lib/auth/backup-codes"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/auth/2fa/enroll — starts TOTP enrollment for the signed-in user.
 * Returns the base32 secret and an `otpauth://` provisioning URI. Nothing is
 * activated until `/api/auth/2fa/confirm` accepts a valid code.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const enrollment = await backend.startTotpEnrollment(user.id)
  // Enrollment resets 2FA state (fresh secret, codes wiped backend-side);
  // drop any API-managed backup-code set so it cannot outlive the reset.
  clearUserBackupCodes(user.id)
  return ok({
    secret: enrollment.secret,
    otpauthUrl: enrollment.otpauthUrl,
    digits: 6,
    periodSeconds: 30,
  })
}
