import { getAuthBackend } from "@/lib/auth/backend"
import { clearUserBackupCodes } from "@/lib/auth/backup-codes"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { disableTotpSchema } from "@/lib/auth/schemas"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/auth/2fa/disable — requires the account password as re-auth. */
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
  const parsed = disableTotpSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Password is required.")

  const disabled = await getAuthBackend().disableTotp(access.uid, parsed.data.password)
  if (!disabled) {
    return fail(400, "totp_invalid", "Incorrect password or 2FA is not enabled.")
  }
  // Drop any API-managed backup-code set so re-enabling later cannot revive it.
  clearUserBackupCodes(access.uid)
  return ok({ disabled: true })
}
