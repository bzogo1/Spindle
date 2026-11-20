import { getAuthBackend } from "@/lib/auth/backend"
import {
  clearUserBackupCodes,
  getBackupCodeStatus,
  issueBackupCodes,
} from "@/lib/auth/backup-codes"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/2fa/backup-codes — status for the signed-in user: whether
 * TOTP two-factor is enabled, whether an API-managed code set exists, and how
 * many unused codes remain. Codes are stored hashed only, so plaintext can
 * never be listed — the count is all there is. `managed: false` means the
 * active set (if any) is the one issued at enrollment.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const enabled = await backend.isTotpEnabled(user.id)
  if (!enabled) {
    // Defensive: a managed set can never be consumed without 2FA, and dropping
    // it here heals state left behind by older builds that did not clear on
    // disable. Enrollment codes are likewise inert while 2FA is off.
    clearUserBackupCodes(user.id)
    return ok({ enabled: false, managed: false, remaining: null })
  }

  return ok({ enabled: true, ...getBackupCodeStatus(user.id) })
}

/**
 * POST /api/auth/2fa/backup-codes — issues a fresh set of one-time backup
 * codes and returns the plaintext exactly once. Requires two-factor
 * authentication to be enabled. Every previously issued code (including the
 * enrollment set) stops working immediately.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  if (!(await backend.isTotpEnabled(user.id))) {
    return fail(403, "totp_not_enabled", "Enable two-factor authentication first.")
  }

  const issued = await issueBackupCodes(user.id)
  return ok({ backupCodes: issued.codes, remaining: issued.remaining })
}
