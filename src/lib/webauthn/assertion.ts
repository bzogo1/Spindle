/**
 * Authentication (assertion) verification.
 *
 * Verifies a `PublicKeyCredential` produced by
 * `navigator.credentials.get()` against the credential's stored COSE public
 * key:
 *
 *   1. clientDataJSON: type "webauthn.get", challenge + origin match.
 *   2. authData: rpIdHash == sha256(rpId), UP flag set.
 *   3. Signature: ECDSA P-256/SHA-256 (ES256) over
 *      `authData || SHA-256(clientDataJSON)`, DER-encoded — exactly what
 *      WebAuthn produces — verified with `node:crypto` against the stored
 *      COSE key converted to JWK.
 *   4. Signature counter: when the authenticator reports a non-zero counter
 *      and the stored counter is also non-zero, the new value must be
 *      strictly greater — a regression means a cloned credential. Both-zero
 *      (counter-less authenticators) is allowed per WebAuthn guidance.
 *
 * Returns the new counter for the caller to persist via
 * `WebAuthnCredentialStore.touch`.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto"

import { parseAuthData, rpIdHashMatches, FLAG_UP, type ParsedAuthData } from "./authdata"
import { verifyClientData, CLIENT_DATA_TYPE_GET } from "./client-data"
import { coseKeyToJwk, parseCoseEc2Key } from "./cose"
import type { AssertionCredentialJSON } from "./public-key-json"
import { base64urlDecode, WebAuthnError } from "./types"

export type VerifiedAssertion = {
  /** Counter value to store via `store.touch(credentialId, signCount)`. */
  signCount: number
  credentialId: string
}

/**
 * Cross-checks the assertion's `userHandle` against the credential owner.
 *
 * At registration the user handle is the UTF-8 bytes of our user id
 * (see options.ts). For discoverable (passkey) credentials the
 * authenticator echoes it back in every assertion; for non-resident
 * security keys it is legitimately `null`.
 *
 * Rules:
 *  - userHandle present → must decode (UTF-8) to `expectedUserId` when one
 *    is supplied. A mismatch means the credential was registered under a
 *    different user handle than the store claims — reject.
 *  - userHandle absent → allowed unless `requireUserHandle` is set (the
 *    anonymous/discoverable sign-in path requires it, since only resident
 *    credentials can answer an empty `allowCredentials` request and they
 *    MUST return the user handle per WebAuthn).
 */
export function verifyUserHandle(
  userHandle: Uint8Array | null,
  expectedUserId: string | undefined,
  requireUserHandle: boolean,
): void {
  if (userHandle === null || userHandle.length === 0) {
    if (requireUserHandle) {
      throw new WebAuthnError(
        "user_handle_missing",
        "The authenticator did not return a user handle for a discoverable credential.",
      )
    }
    return
  }
  if (expectedUserId === undefined) return
  const decoded = new TextDecoder().decode(userHandle)
  if (decoded !== expectedUserId) {
    throw new WebAuthnError(
      "user_handle_mismatch",
      "The assertion user handle does not match the credential owner.",
    )
  }
}

export function verifyAssertionObject(
  parsed: ParsedAuthData,
  rpId: string,
  storedCounter: number,
): number {
  if (!rpIdHashMatches(parsed.rpIdHash, rpId)) {
    throw new WebAuthnError(
      "rp_id_mismatch",
      "authenticatorData rpIdHash does not match this site.",
    )
  }
  if ((parsed.flags & FLAG_UP) === 0) {
    throw new WebAuthnError("user_not_present", "The authenticator did not confirm user presence.")
  }
  // Clone detection: only meaningful when BOTH sides count. An authenticator
  // that always reports 0 cannot be distinguished from a clone this way.
  if (storedCounter > 0 && parsed.signCount <= storedCounter) {
    throw new WebAuthnError(
      "counter_regression",
      "The authenticator signature counter did not increase; the credential may be cloned.",
    )
  }
  return parsed.signCount
}

export function verifyAssertion(input: {
  credential: AssertionCredentialJSON
  /** base64url challenge exactly as issued by the challenge store. */
  challenge: string
  rpId: string
  /** Full origin the ceremony must have run on. */
  origin: string
  /** base64url COSE_Key stored at registration. */
  publicKeyCose: string
  /** Counter recorded at the last successful assertion (0 for new keys). */
  storedCounter: number
  /**
   * UTF-8 user id the userHandle must decode to (the credential owner's
   * user id). When omitted, a present userHandle is not cross-checked.
   */
  expectedUserId?: string
  /** Require a non-empty userHandle (discoverable/passkey sign-in). */
  requireUserHandle?: boolean
}): VerifiedAssertion {
  const {
    credential,
    challenge,
    rpId,
    origin,
    publicKeyCose,
    storedCounter,
    expectedUserId,
    requireUserHandle = false,
  } = input

  verifyClientData({
    clientDataJSON: credential.clientDataJSON,
    expectedType: CLIENT_DATA_TYPE_GET,
    expectedChallenge: challenge,
    expectedOrigin: origin,
  })

  const coseBytes = base64urlDecode(publicKeyCose)
  const cose = coseBytes ? parseCoseEc2Key(coseBytes) : null
  if (!cose) {
    throw new WebAuthnError("unsupported_key", "The stored credential key cannot be parsed.")
  }

  let parsed: ParsedAuthData
  try {
    parsed = parseAuthData(credential.authenticatorData, false)
  } catch (error) {
    if (error instanceof WebAuthnError) throw error
    throw new WebAuthnError("invalid_auth_data", "authenticatorData could not be parsed.")
  }

  verifyUserHandle(credential.userHandle, expectedUserId, requireUserHandle)

  const signCount = verifyAssertionObject(parsed, rpId, storedCounter)

  const signed = Buffer.concat([
    Buffer.from(credential.authenticatorData),
    createHash("sha256").update(credential.clientDataJSON).digest(),
  ])

  const key = createPublicKey({ key: coseKeyToJwk(cose.key), format: "jwk" })
  // WebAuthn signatures are ASN.1 DER ECDSA — node:crypto's default
  // dsaEncoding ("der") matches; ieee-p1363 would NOT verify.
  const signatureOk = cryptoVerify("sha256", signed, key, Buffer.from(credential.signature))
  if (!signatureOk) {
    throw new WebAuthnError("bad_signature", "The assertion signature is invalid.")
  }

  return { signCount, credentialId: credential.rawId }
}
