import { z } from "zod"

import { getAuthBackend } from "@/lib/auth/backend"
import { getDeviceFingerprintStore, parseDeviceFingerprint } from "@/lib/auth/fingerprint"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { getTrustedDeviceStore } from "@/lib/auth/totp-devices"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

const trustSchema = z.object({
  label: z.string().max(200).optional(),
  /**
   * Fresh TOTP proof required at trust time. Sessions issued via
   * passwordless/OAuth never pass through the TOTP challenge, so "has a
   * session on a 2FA-enabled account" is NOT sufficient to arm a persistent
   * second-factor bypass — the caller must prove possession of the
   * authenticator right now. Whitespace is stripped before the 6-digit
   * check; backup codes are deliberately NOT accepted here (they are
   * single-use and would be burned by a trust action).
   */
  totpCode: z
    .string()
    .transform((value) => value.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/)),
  /**
   * Optional echo of the device fingerprint. It is NEVER trusted on its own:
   * when present it must match the fingerprint this session registered via
   * /api/auth/fingerprint, and the session record is what actually gets
   * trusted. This prevents arming arbitrary digests.
   */
  fingerprint: z.string().max(200).optional(),
})

/**
 * POST /api/auth/2fa/devices/trust — marks the caller's device as trusted for
 * the second factor.
 *
 * REQUIREMENTS (all enforced server-side):
 *   1. same-origin request within the per-IP rate limit,
 *   2. a valid authenticated session whose user still exists,
 *   3. TOTP two-factor currently ENABLED on the account,
 *   4. a FRESH 6-digit TOTP code verified via `verifyUserTotp` — this is the
 *      "recently verified" signal the session token lacks, required because
 *      passwordless/OAuth sessions never see the TOTP challenge, and
 *   5. a resolvable device fingerprint: ONLY the one registered for this
 *      session (`sid`) via /api/auth/fingerprint. A body-supplied `fingerprint`
 *      is accepted solely as a consistency check and must match; it can never
 *      introduce a digest the session did not register.
 *
 * Body: `{ "totpCode": "123456", "label"?: string, "fingerprint"?: string }`.
 * Response: `{ ok, device }` — idempotent; re-trusting refreshes the record.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")
  if (!(await backend.isTotpEnabled(user.id))) {
    return fail(403, "totp_not_enabled", "Enable two-factor authentication first.")
  }

  let body: unknown = {}
  const rawBody = await request.text()
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return fail(400, "invalid_request", "Invalid request body.")
    }
  }
  const parsed = trustSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Enter the 6-digit code from your authenticator.")
  }

  // Fresh second-factor proof BEFORE any state change. Rate limiting above
  // plus TOTP's 30s step bounds guessing; a wrong code burns nothing.
  const totpOk = await backend.verifyUserTotp(user.id, parsed.data.totpCode)
  if (!totpOk) {
    return fail(401, "totp_invalid", "Invalid authenticator code. Try again.")
  }

  // Device identity comes ONLY from the fingerprint this session registered
  // via /api/auth/fingerprint — never from a client-supplied digest. A body
  // `fingerprint` is just an echo check: it must match the session record.
  const sessionFingerprint = getDeviceFingerprintStore().getForSession(access.sid)
  if (!sessionFingerprint) {
    return fail(
      400,
      "fingerprint_required",
      "This device could not be identified. Reload and try again.",
    )
  }
  if (parsed.data.fingerprint !== undefined) {
    const echoed = parseDeviceFingerprint(parsed.data.fingerprint)
    const echoedHash = echoed ? `${echoed.version}:${echoed.hash}` : null
    if (echoedHash !== sessionFingerprint.hash) {
      return fail(400, "invalid_request", "Device fingerprint does not match this session.")
    }
  }

  let device
  try {
    device = getTrustedDeviceStore().trust({
      userId: user.id,
      fingerprintHash: sessionFingerprint.hash,
      sessionId: access.sid,
      label: parsed.data.label,
    })
  } catch {
    return fail(400, "invalid_request", "This device could not be identified.")
  }

  return ok({
    device: {
      id: device.id,
      label: device.label,
      fingerprintVersion: device.fingerprintVersion,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
    },
  })
}
