import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { verifyRegistration } from "@/lib/webauthn/attestation"
import { getChallengeStore } from "@/lib/webauthn/challenge-store"
import { getCredentialStore } from "@/lib/webauthn/credential-store"
import { parseRegistrationCredential } from "@/lib/webauthn/public-key-json"
import { rpFromRequest } from "@/lib/webauthn/rp"
import { isRecord, toCredentialView, WebAuthnError } from "@/lib/webauthn/types"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

function badRequest(error: WebAuthnError) {
  return fail(400, error.code, error.message)
}

/**
 * POST /api/auth/webauthn/register/complete — finishes the registration
 * ceremony. Body: `{ challengeId, credential, label? }` where `credential`
 * is the `PublicKeyCredential.toJSON()` output.
 *
 * The challenge is consumed FIRST (single-use): a replayed or expired
 * challenge is rejected before any signature work. Then the attestation is
 * verified ("none" fmt only — see src/lib/webauthn/attestation.ts) and the
 * credential's public half is stored. Only EC2 P-256/ES256 keys are
 * accepted.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  if (!isRecord(body)) return fail(400, "invalid_request", "Invalid request body.")
  const { challengeId, credential: rawCredential, label } = body
  if (typeof challengeId !== "string" || challengeId.length === 0) {
    return fail(400, "invalid_request", "challengeId is required.")
  }

  const store = getChallengeStore()
  const challenge = store.consume(challengeId, user.id, "register")
  if (!challenge) {
    return fail(400, "invalid_challenge", "The registration challenge is invalid or expired.")
  }

  let credential
  try {
    credential = parseRegistrationCredential(rawCredential)
  } catch (error) {
    if (error instanceof WebAuthnError) return badRequest(error)
    throw error
  }

  const rp = rpFromRequest(request)
  let verified
  try {
    verified = verifyRegistration({
      credential,
      challenge: challenge.challenge,
      rpId: rp.rpId,
      origin: rp.origin,
    })
  } catch (error) {
    if (error instanceof WebAuthnError) return badRequest(error)
    throw error
  }

  // The credential id in the JSON envelope must match the one inside
  // authData — a mismatch means a malformed or tampered payload.
  if (credential.id !== verified.credentialId) {
    return fail(400, "credential_mismatch", "Credential id does not match authenticatorData.")
  }

  try {
    const saved = getCredentialStore().save({
      userId: user.id,
      credentialId: verified.credentialId,
      publicKeyCose: verified.publicKeyCose,
      counter: verified.counter,
      transports: verified.transports,
      aaguid: verified.aaguid,
      // The challenge records which ceremony begin issued ("passkey" →
      // residentKey: "required" options, anything else → "security-key").
      // KNOWN LIMITATION: `kind` is ASSERTED, not verified. The client picks
      // it via the begin body, and attestation here is "none"-fmt only, so
      // nothing in the attestation proves the credential is actually
      // discoverable/resident — a client could request passkey options yet
      // produce a non-resident key (or vice versa). This is cosmetic-only:
      // `kind` drives panel grouping and labels, while sign-in never branches
      // on it (auth/complete resolves the owner from the credential id and
      // accepts any stored credential), so a mislabel cannot weaken auth.
      kind: challenge.kind === "passkey" ? "passkey" : "security-key",
      label: typeof label === "string" ? label : undefined,
    })
    logger.info(
      { event: "auth.webauthn.register", userId: user.id, credentialId: saved.id },
      "Security key registered.",
    )
    return ok({ credential: toCredentialView(saved) })
  } catch (error) {
    if (error instanceof TypeError) {
      return fail(409, "credential_exists", "This security key is already registered.")
    }
    throw error
  }
}
