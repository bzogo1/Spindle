import type { NextResponse } from "next/server"
import { z } from "zod"

import { getAuthBackend, type AuthUser } from "@/lib/auth/backend"
import {
  getDeviceTrustStore,
  maskFingerprintHash,
  MAX_TRUST_TTL_MS,
  type DeviceTrustGrant,
} from "@/lib/auth/device-trust"
import { getDeviceFingerprintStore, parseDeviceFingerprint } from "@/lib/auth/fingerprint"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import type { AccessTokenPayload } from "@/lib/auth/token-codec"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 })
const writeLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 1000 })

const grantSchema = z.object({
  label: z.string().max(200).optional(),
  /**
   * Optional TTL override in ms. The store clamps it into
   * [MIN_TRUST_TTL_MS, MAX_TRUST_TTL_MS] (1h .. 1y); absent means the 30-day
   * default. Bounded here too so absurd values fail fast.
   */
  ttlMs: z.number().finite().positive().max(MAX_TRUST_TTL_MS).optional(),
  /**
   * Optional echo of the device fingerprint. NEVER trusted on its own: when
   * present it must match the fingerprint this session registered via
   * /api/auth/fingerprint — the session record is what actually gets
   * trusted, so clients cannot arm arbitrary digests.
   */
  fingerprint: z.string().max(200).optional(),
})

/** Client-safe grant shape — the raw digest is masked, never echoed. */
function grantPayload(grant: DeviceTrustGrant) {
  return {
    id: grant.id,
    label: grant.label,
    // Display-safe masked digest ("fp1:9f86d0…f2a1") — the full hash never
    // leaves the server.
    fingerprint: maskFingerprintHash(grant.fingerprintHash),
    fingerprintVersion: grant.fingerprintVersion,
    level: grant.level,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
    lastSeenAt: grant.lastSeenAt,
  }
}

async function requireUser(
  request: Request,
): Promise<{ error: NextResponse } | { access: AccessTokenPayload; user: AuthUser }> {
  const access = accessTokenFromRequest(request)
  if (!access) return { error: fail(401, "unauthenticated", "Sign in required.") }
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return { error: fail(401, "unauthenticated", "Sign in required.") }
  return { access, user }
}

/**
 * GET /api/auth/device-trust — the caller's active device-trust grants plus
 * `currentDevice` so the panel can tell whether THIS session's registered
 * fingerprint is already trusted. Devices are identified by fingerprint hash
 * server-side; clients only ever see the masked digest.
 */
export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!readLimiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const auth = await requireUser(request)
  if ("error" in auth) return auth.error
  const { access, user } = auth

  const grants = getDeviceTrustStore().listActive(user.id)

  // The current session's fingerprint (registered via /api/auth/fingerprint)
  // tells us whether "this device" is already trusted. Absent a registered
  // fingerprint we cannot prove identity, so currentDevice stays untrusted.
  const sessionFingerprint = getDeviceFingerprintStore().getForSession(access.sid)
  const currentGrant = sessionFingerprint
    ? getDeviceTrustStore().findActiveByFingerprint(user.id, sessionFingerprint.hash)
    : null

  return ok({
    devices: grants.map(grantPayload),
    currentDevice: {
      trusted: currentGrant !== null,
      deviceId: currentGrant?.id ?? null,
    },
  })
}

/**
 * POST /api/auth/device-trust — grants trust to the caller's current device.
 *
 * REQUIREMENTS (all enforced server-side):
 *   1. same-origin request within the per-IP rate limit,
 *   2. a valid authenticated session whose user still exists,
 *   3. a resolvable device fingerprint: ONLY the one registered for this
 *      session (`sid`) via /api/auth/fingerprint. A body-supplied
 *      `fingerprint` is accepted solely as a consistency echo and must match;
 *      it can never introduce a digest the session did not register.
 *
 * Unlike the TOTP trust route this does NOT require a fresh second factor:
 * device trust only reduces sign-in friction (see DEVICE_TRUST_BENEFITS in
 * `src/lib/auth/device-trust.ts`) and never bypasses the password step, so a
 * live session is sufficient proof of intent. A follow-up may add a
 * re-authentication check without changing the store.
 *
 * Body: `{ "label"?: string, "ttlMs"?: number, "fingerprint"?: string }`.
 * Response: `{ ok, device }` — idempotent; re-granting refreshes expiry.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const auth = await requireUser(request)
  if ("error" in auth) return auth.error
  const { access, user } = auth

  let body: unknown = {}
  const rawBody = await request.text()
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      return fail(400, "invalid_request", "Invalid request body.")
    }
  }
  const parsed = grantSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_request", "Invalid device-trust request.")
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

  let grant
  try {
    grant = getDeviceTrustStore().grant({
      userId: user.id,
      fingerprintHash: sessionFingerprint.hash,
      sessionId: access.sid,
      label: parsed.data.label,
      ttlMs: parsed.data.ttlMs,
    })
  } catch {
    return fail(400, "invalid_request", "This device could not be identified.")
  }

  return ok({ device: grantPayload(grant) })
}

/**
 * DELETE /api/auth/device-trust — revokes ALL active trust grants for the
 * caller (the panic button). Per-grant revocation lives at
 * `/api/auth/device-trust/[id]`. Idempotent: `{ ok, revoked }` either way.
 */
export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const auth = await requireUser(request)
  if ("error" in auth) return auth.error

  const revoked = getDeviceTrustStore().revokeAll(auth.user.id)
  return ok({ revoked })
}
