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
import { buildRequestOptions, toCredentialDescriptors } from "@/lib/webauthn/options"
import { rpFromRequest } from "@/lib/webauthn/rp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

/**
 * POST /api/auth/webauthn/auth/begin — starts the authentication ceremony.
 * Works with OR without a session:
 *
 *  - Signed in: the challenge is bound to the caller and `allowCredentials`
 *    lists their registered keys (non-discoverable flow).
 *  - Anonymous: the challenge is issued unbound (`userId: ""`) and
 *    `allowCredentials` is empty, asking the authenticator for any
 *    discoverable (resident) credential for this rpId. The credential's
 *    owner is resolved from the assertion itself in auth/complete.
 *
 * Returns `PublicKeyCredentialRequestOptions` JSON for
 * `navigator.credentials.get()`.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  // Optional session: presence only narrows allowCredentials + binds the
  // challenge. An invalid/expired cookie is treated as anonymous, not as an
  // error — the ceremony itself is the authentication.
  const access = accessTokenFromRequest(request)
  const user = access ? await getAuthBackend().getUserById(access.uid) : null

  const rp = rpFromRequest(request)
  const challenge = getChallengeStore().issue({
    userId: user?.id ?? "",
    purpose: "authenticate",
  })

  const allowCredentials = user
    ? toCredentialDescriptors(getCredentialStore().listActive(user.id))
    : []

  const options = buildRequestOptions({
    challenge: challenge.challenge,
    rpId: rp.rpId,
    allowCredentials,
  })

  return ok({ challengeId: challenge.id, options })
}
