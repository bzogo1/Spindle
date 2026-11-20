import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getChallengeStore } from "@/lib/webauthn/challenge-store"
import { getCredentialStore } from "@/lib/webauthn/credential-store"
import { buildRegistrationOptions, toCredentialDescriptors } from "@/lib/webauthn/options"
import { rpFromRequest } from "@/lib/webauthn/rp"
import { isRecord } from "@/lib/webauthn/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

/**
 * POST /api/auth/webauthn/register/begin — starts the registration ceremony.
 * Requires a session (you can only bind a security key to a signed-in
 * account). Issues a single-use, 5-minute challenge and returns
 * `PublicKeyCredentialCreationOptions` JSON for
 * `navigator.credentials.create()`. Existing credentials are sent as
 * `excludeCredentials` so re-registering the same key fails fast in the
 * browser.
 *
 * Body (optional): `{ "passkey": true }` requests a discoverable
 * (resident-key) credential — `residentKey: "required"` — for the passkey
 * flow. The flag is recorded on the challenge so register/complete stores
 * the credential with `kind: "passkey"`. Absent/invalid bodies default to
 * the security-key ceremony (`residentKey: "preferred"`).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  // Optional JSON body; an empty or malformed body is the security-key flow.
  let passkey = false
  try {
    const body: unknown = await request.json()
    passkey = isRecord(body) && body.passkey === true
  } catch {
    // No/invalid JSON body — default security-key registration.
  }

  const rp = rpFromRequest(request)
  const challenge = getChallengeStore().issue({
    userId: user.id,
    purpose: "register",
    ...(passkey ? { kind: "passkey" as const } : {}),
  })
  const existing = getCredentialStore().listActive(user.id)

  const options = buildRegistrationOptions({
    challenge: challenge.challenge,
    rpId: rp.rpId,
    rpName: rp.rpName,
    userId: user.id,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    excludeCredentials: toCredentialDescriptors(existing),
    ...(passkey
      ? { residentKey: "required" as const, userVerification: "preferred" as const }
      : {}),
  })

  return ok({ challengeId: challenge.id, options })
}
