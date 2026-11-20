/**
 * Registration (attestation) verification.
 *
 * Verifies a `PublicKeyCredential` created by `navigator.credentials.create()`
 * for the "none" attestation format:
 *
 *   1. clientDataJSON: type "webauthn.create", challenge + origin match.
 *   2. attestationObject (CBOR): fmt === "none" with an empty attStmt.
 *      Packed/fido-u2f/tpm/android-key/safechain attestation statements are
 *      REJECTED — chain verification against authenticator metadata is a
 *      documented gap (see docs note in this directory's README section of
 *      the task report); "none" is what browsers request by default and is
 *      acceptable for this deployment because the credential's COSE key is
 *      what matters for later assertion verification.
 *   3. authData: rpIdHash == sha256(rpId), UP flag set, AT flag set, and a
 *      parseable attested credential carrying an EC2/P-256 COSE key with
 *      alg ES256 — the only key type `assertion.ts` can verify.
 *
 * Returns everything the credential store needs; the private key never
 * leaves the authenticator.
 */

import { parseAuthData, rpIdHashMatches, FLAG_UP, type ParsedAuthData } from "./authdata"
import { decodeCbor, type CborValue } from "./cbor"
import { verifyClientData, CLIENT_DATA_TYPE_CREATE } from "./client-data"
import { parseCoseEc2Key, type Ec2PublicKey } from "./cose"
import type { RegistrationCredentialJSON } from "./public-key-json"
import { base64urlEncode, WebAuthnError } from "./types"

export type VerifiedAttestation = {
  /** base64url credential id (stored as the credential's primary key). */
  credentialId: string
  credentialIdBytes: Uint8Array
  /** base64url of the raw COSE_Key bytes (stored for later assertion verify). */
  publicKeyCose: string
  coseKey: Ec2PublicKey
  /** Authenticator signature counter at registration. */
  counter: number
  transports: string[]
  /** base64url AAGUID (16 bytes) when present. */
  aaguid: string | null
}

const SUPPORTED_FMT = "none"

type AttestationObject = {
  fmt: string
  attStmt: Map<number | string, CborValue>
  authData: Uint8Array
}

function parseAttestationObject(bytes: Uint8Array): AttestationObject {
  const value = decodeCbor(bytes)
  if (!(value instanceof Map)) {
    throw new WebAuthnError("invalid_attestation", "attestationObject is not a CBOR map.")
  }
  const fmt = value.get("fmt")
  const attStmt = value.get("attStmt")
  const authData = value.get("authData")
  if (typeof fmt !== "string" || !(attStmt instanceof Map) || !(authData instanceof Uint8Array)) {
    throw new WebAuthnError("invalid_attestation", "attestationObject is malformed.")
  }
  return { fmt, attStmt, authData }
}

export function verifyAttestationObject(
  parsed: ParsedAuthData,
  rpId: string,
): { counter: number; coseKeyBytes: Uint8Array; coseKey: Ec2PublicKey } {
  if (!rpIdHashMatches(parsed.rpIdHash, rpId)) {
    throw new WebAuthnError(
      "rp_id_mismatch",
      "authenticatorData rpIdHash does not match this site.",
    )
  }
  if ((parsed.flags & FLAG_UP) === 0) {
    throw new WebAuthnError("user_not_present", "The authenticator did not confirm user presence.")
  }
  if (parsed.attested === undefined) {
    throw new WebAuthnError("missing_attestation", "No attested credential data in authData.")
  }
  const cose = parseCoseEc2Key(parsed.attested.coseKeyBytes)
  if (!cose) {
    throw new WebAuthnError(
      "unsupported_key",
      "Only EC2 P-256 keys with the ES256 algorithm are supported.",
    )
  }
  return {
    counter: parsed.signCount,
    coseKeyBytes: parsed.attested.coseKeyBytes,
    coseKey: cose.key,
  }
}

export function verifyRegistration(input: {
  credential: RegistrationCredentialJSON
  /** base64url challenge exactly as issued by the challenge store. */
  challenge: string
  rpId: string
  /** Full origin the ceremony must have run on. */
  origin: string
}): VerifiedAttestation {
  const { credential, challenge, rpId, origin } = input

  verifyClientData({
    clientDataJSON: credential.clientDataJSON,
    expectedType: CLIENT_DATA_TYPE_CREATE,
    expectedChallenge: challenge,
    expectedOrigin: origin,
  })

  const attestation = parseAttestationObject(credential.attestationObject)
  if (attestation.fmt !== SUPPORTED_FMT) {
    throw new WebAuthnError(
      "unsupported_attestation",
      `Attestation format "${attestation.fmt}" is not supported; only "none" is accepted.`,
    )
  }
  if (attestation.attStmt.size !== 0) {
    throw new WebAuthnError("invalid_attestation", 'fmt "none" must carry an empty attStmt.')
  }

  let parsed: ParsedAuthData
  try {
    parsed = parseAuthData(attestation.authData, true)
  } catch (error) {
    if (error instanceof WebAuthnError) throw error
    throw new WebAuthnError("invalid_auth_data", "authenticatorData could not be parsed.")
  }

  const { counter, coseKeyBytes, coseKey } = verifyAttestationObject(parsed, rpId)
  const attested = parsed.attested!

  return {
    credentialId: attested.credentialIdB64,
    credentialIdBytes: attested.credentialId,
    publicKeyCose: base64urlEncode(coseKeyBytes),
    coseKey,
    counter,
    transports: credential.transports,
    aaguid: attested.aaguid.length > 0 ? base64urlEncode(attested.aaguid) : null,
  }
}
