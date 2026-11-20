import { getAuthBackend } from "@/lib/auth/backend"
import { getDeviceFingerprintStore, parseDeviceFingerprint } from "@/lib/auth/fingerprint"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { clientIp, createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Generous per-IP limit: registration normally happens once per session,
 * but retries/refreshes and shared NATs must not trip it. Same best-effort
 * fixed-window model as the sibling `/api/auth/*` routes.
 */
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 })

/**
 * POST /api/auth/fingerprint — registers the caller's device fingerprint for
 * the current session.
 *
 * Body: `{ "fingerprint": "fp1:<hex-digest>" }` — the versioned digest
 * produced by `src/lib/device/fingerprint-client.ts`. Raw device signals
 * never reach the server; only the hash is stored (see
 * `src/lib/auth/fingerprint.ts` for the in-memory store caveat).
 *
 * Auth: requires a valid `spindle_at` access cookie whose user still exists;
 * the record is keyed by (userId, sessionId) from the token so one user can
 * hold fingerprints for multiple concurrent sessions/devices.
 *
 * Response: `{ ok: true, match, fingerprint: { version, seenCount } }` where
 * `match` is `"new" | "known" | "changed"` — a soft signal only; clients must
 * not treat `changed` as an error.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid JSON body.")
  }

  const raw =
    typeof body === "object" && body !== null
      ? (body as { fingerprint?: unknown }).fingerprint
      : undefined
  const parsed = parseDeviceFingerprint(raw)
  if (!parsed) {
    return fail(400, "invalid_request", "A valid device fingerprint is required.")
  }

  const { match, record } = getDeviceFingerprintStore().register({
    userId: access.uid,
    sessionId: access.sid,
    // Store the full versioned digest (`fp1:<hex>`) so records stay
    // self-describing and future algorithm versions can coexist.
    hash: `${parsed.version}:${parsed.hash}`,
  })

  return ok({
    match,
    fingerprint: {
      version: record.version,
      hash: record.hash,
      seenCount: record.seenCount,
      lastSeenAt: record.lastSeenAt,
    },
  })
}

/**
 * DELETE /api/auth/fingerprint — drops the fingerprint record for the
 * caller's current session (`sid` from the access token). Called best-effort
 * during sign-out so a later sign-in on the same browser is not compared
 * against a stale record. Idempotent: `{ ok: true, removed }` either way.
 * The access token itself is sufficient — `sid` is unguessable and scoped
 * to this session, so no user lookup is needed.
 */
export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many requests. Try again later.")
  }

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const removed = getDeviceFingerprintStore().removeSession(access.sid)
  return ok({ removed })
}
