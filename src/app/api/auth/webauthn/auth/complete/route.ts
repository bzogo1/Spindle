import { getAuthBackend } from "@/lib/auth/backend"
import { applyAuthCookies, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { evaluateSuccessfulSignIn } from "@/lib/auth/login-alerts"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { verifyAssertion } from "@/lib/webauthn/assertion"
import { getChallengeStore } from "@/lib/webauthn/challenge-store"
import { getCredentialStore } from "@/lib/webauthn/credential-store"
import { parseAssertionCredential } from "@/lib/webauthn/public-key-json"
import { rpFromRequest } from "@/lib/webauthn/rp"
import { isRecord, WebAuthnError } from "@/lib/webauthn/types"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

/**
 * POST /api/auth/webauthn/auth/complete — finishes the authentication
 * ceremony and signs the credential's owner in. Body:
 * `{ challengeId, credential }` where `credential` is the
 * `PublicKeyCredential.toJSON()` output of `navigator.credentials.get()`.
 *
 * Flow: the credential id inside the assertion resolves the stored
 * credential (and therefore the user — credential ids are
 * authenticator-generated randoms, so possession of a valid signature is
 * the authentication). The challenge is then consumed under the OWNER's
 * userId — this works for both session-bound challenges (signed-in begin)
 * and anonymous discoverable-credential challenges (userId "").
 *
 * All credential/assertion failures share 401 `invalid_assertion` so the
 * endpoint cannot be used to probe which credential ids exist; only a
 * well-formed request with a bad challenge gets 400.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  if (!isRecord(body)) return fail(400, "invalid_request", "Invalid request body.")
  const { challengeId, credential: rawCredential } = body
  if (typeof challengeId !== "string" || challengeId.length === 0) {
    return fail(400, "invalid_request", "challengeId is required.")
  }

  let credential
  try {
    credential = parseAssertionCredential(rawCredential)
  } catch {
    return fail(401, "invalid_assertion", "The security key response is invalid.")
  }

  const credentialStore = getCredentialStore()
  const stored = credentialStore.findActiveByCredentialId(credential.rawId)
  if (!stored) {
    return fail(401, "invalid_assertion", "This security key is not registered.")
  }

  // Consume-before-verify is deliberate (TOCTOU-safe): the challenge is
  // burned the moment it is claimed, so a failed signature check cannot be
  // retried against the same challenge — the user must restart sign-in.
  const challenge = getChallengeStore().consume(challengeId, stored.userId, "authenticate")
  if (!challenge) {
    return fail(400, "invalid_challenge", "The authentication challenge is invalid or expired.")
  }

  const rp = rpFromRequest(request)
  try {
    const verified = verifyAssertion({
      credential,
      challenge: challenge.challenge,
      rpId: rp.rpId,
      origin: rp.origin,
      publicKeyCose: stored.publicKeyCose,
      storedCounter: stored.counter,
      // The userHandle must decode to the credential owner's user id — it is
      // the UTF-8 user id we set at registration. Anonymous challenges
      // (discoverable/passkey sign-in, allowCredentials: []) REQUIRE a
      // userHandle: only resident credentials can answer them, and they must
      // echo the handle back. Session-bound challenges allow a null
      // userHandle for non-resident security keys but still reject a
      // mismatched one.
      expectedUserId: stored.userId,
      requireUserHandle: challenge.userId === "",
    })
    credentialStore.touch(stored.id, verified.signCount)
  } catch (error) {
    if (error instanceof WebAuthnError) {
      return fail(401, "invalid_assertion", error.message)
    }
    throw error
  }

  const backend = getAuthBackend()
  const user = await backend.getUserById(stored.userId)
  if (!user) {
    return fail(401, "invalid_assertion", "This security key is not registered.")
  }

  const tokens = await backend.createSessionForUser(user.id)
  evaluateSuccessfulSignIn({
    userId: user.id,
    email: user.email,
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  })
  logger.info(
    { event: "auth.webauthn.signin", userId: user.id, credentialId: stored.id },
    "Security-key sign-in.",
  )
  const response = ok({ session: tokens.session })
  response.headers.set("cache-control", "no-store")
  return applyAuthCookies(response, tokens, { remember: true })
}
