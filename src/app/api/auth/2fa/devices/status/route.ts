import { getAuthBackend } from "@/lib/auth/backend"
import { getDeviceFingerprintStore } from "@/lib/auth/fingerprint"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import { getTrustedDeviceStore } from "@/lib/auth/totp-devices"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/2fa/devices/status — lightweight status probe for the 2FA
 * device UI: whether TOTP is enabled, how many devices are trusted, and
 * whether the current session's fingerprint is among them.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const store = getTrustedDeviceStore()
  const totpEnabled = await backend.isTotpEnabled(user.id)
  const sessionFingerprint = getDeviceFingerprintStore().getForSession(access.sid)
  const currentDevice = sessionFingerprint
    ? store.findActiveByFingerprint(user.id, sessionFingerprint.hash)
    : null

  return ok({
    totpEnabled,
    trustedCount: store.listActive(user.id).length,
    currentDeviceTrusted: currentDevice !== null,
  })
}
