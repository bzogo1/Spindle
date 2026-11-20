import { getAuthBackend } from "@/lib/auth/backend"
import { getDeviceFingerprintStore } from "@/lib/auth/fingerprint"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import { getTrustedDeviceStore } from "@/lib/auth/totp-devices"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Public shape of a trusted device — the raw fingerprint digest is never echoed. */
function devicePayload(device: {
  id: string
  label: string
  fingerprintVersion: string
  createdAt: string
  lastUsedAt: string
}) {
  return {
    id: device.id,
    label: device.label,
    fingerprintVersion: device.fingerprintVersion,
    createdAt: device.createdAt,
    lastUsedAt: device.lastUsedAt,
  }
}

/**
 * GET /api/auth/2fa/devices — the caller's trusted 2FA devices plus status
 * flags the panel needs: whether TOTP is enabled and whether THIS session's
 * registered fingerprint is already trusted (so "trust this device" can hide
 * itself). Devices are identified by fingerprint hash server-side; clients
 * only ever see the algorithm version, never the digest.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const totpEnabled = await backend.isTotpEnabled(user.id)

  const devices = getTrustedDeviceStore().listActive(user.id)

  // The current session's fingerprint (registered via /api/auth/fingerprint)
  // tells us whether "this device" is already trusted. Absent a registered
  // fingerprint we cannot prove identity, so currentDevice stays untrusted.
  const sessionFingerprint = getDeviceFingerprintStore().getForSession(access.sid)
  const currentDevice = sessionFingerprint
    ? getTrustedDeviceStore().findActiveByFingerprint(user.id, sessionFingerprint.hash)
    : null

  return ok({
    totpEnabled,
    devices: devices.map(devicePayload),
    currentDevice: {
      trusted: currentDevice !== null,
      deviceId: currentDevice?.id ?? null,
    },
  })
}
