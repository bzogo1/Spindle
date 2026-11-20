/**
 * Shared parsing for the `authenticatorData` byte string that appears in
 * both registration (attestation) and authentication (assertion) responses.
 *
 * Layout (WebAuthn L2 §6.1):
 *   rpIdHash(32) | flags(1) | signCount(4)
 *   | attestedCredentialData(…)   — only when flags.AT is set (registration)
 *   | extensions(…)               — only when flags.ED is set (ignored)
 *
 * attestedCredentialData:
 *   aaguid(16) | credentialIdLength(2, BE) | credentialId(…) | COSE key(…)
 */

import { createHash } from "node:crypto"

import { decodeCborItem } from "./cbor"
import { WebAuthnError, base64urlEncode } from "./types"

export const FLAG_UP = 0x01
export const FLAG_UV = 0x04
export const FLAG_BE = 0x08
export const FLAG_AT = 0x40
export const FLAG_ED = 0x80

const AUTH_DATA_MIN_LENGTH = 37

export type AttestedCredential = {
  /** 16-byte AAGUID. */
  aaguid: Uint8Array
  /** Raw credential id bytes. */
  credentialId: Uint8Array
  /** base64url credential id (the value used as `id`/`rawId`). */
  credentialIdB64: string
  /** Raw COSE_Key bytes (not yet parsed/validated). */
  coseKeyBytes: Uint8Array
  /** Offset just past the COSE key within authData (extensions start here). */
  coseKeyEnd: number
}

export type ParsedAuthData = {
  rpIdHash: Uint8Array
  flags: number
  signCount: number
  attested?: AttestedCredential
  /** Offset of extensions within authData when FLAG_ED is set. */
  extensionsOffset: number
}

export function parseAuthData(data: Uint8Array, expectAttested: boolean): ParsedAuthData {
  if (data.length < AUTH_DATA_MIN_LENGTH) {
    throw new WebAuthnError("invalid_auth_data", "authenticatorData is too short.")
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const rpIdHash = data.slice(0, 32)
  const flags = data[32]
  const signCount = view.getUint32(33)

  const hasAttested = (flags & FLAG_AT) !== 0
  if (expectAttested && !hasAttested) {
    throw new WebAuthnError(
      "missing_attestation",
      "authenticatorData lacks attested credential data.",
    )
  }

  let offset = AUTH_DATA_MIN_LENGTH
  let attested: AttestedCredential | undefined

  if (hasAttested) {
    if (offset + 18 > data.length) {
      throw new WebAuthnError("invalid_auth_data", "Truncated attested credential data.")
    }
    const aaguid = data.slice(offset, offset + 16)
    const credentialIdLength = view.getUint16(offset + 16)
    offset += 18
    if (offset + credentialIdLength > data.length) {
      throw new WebAuthnError("invalid_auth_data", "Truncated credential id.")
    }
    const credentialId = data.slice(offset, offset + credentialIdLength)
    offset += credentialIdLength
    if (credentialIdLength === 0 || credentialIdLength > 1023) {
      throw new WebAuthnError("invalid_auth_data", "Credential id length out of range.")
    }

    // The COSE key is a single CBOR item; decode just enough to learn its
    // length (extensions, if any, follow it).
    let coseKeyEnd: number
    try {
      const item = decodeCborItem(data, offset)
      coseKeyEnd = item.next
    } catch {
      throw new WebAuthnError("invalid_auth_data", "Malformed COSE public key.")
    }
    if (coseKeyEnd <= offset || coseKeyEnd > data.length) {
      throw new WebAuthnError("invalid_auth_data", "Malformed COSE public key.")
    }

    attested = {
      aaguid,
      credentialId,
      credentialIdB64: base64urlEncode(credentialId),
      coseKeyBytes: data.slice(offset, coseKeyEnd),
      coseKeyEnd,
    }
    offset = coseKeyEnd
  }

  return {
    rpIdHash,
    flags,
    signCount,
    attested,
    extensionsOffset: offset,
  }
}

/** sha256 of the rpId must equal the leading 32 bytes of authData. */
export function rpIdHashMatches(rpIdHash: Uint8Array, rpId: string): boolean {
  const expected = new Uint8Array(createHash("sha256").update(rpId, "utf8").digest())
  if (expected.length !== rpIdHash.length) return false
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== rpIdHash[i]) return false
  }
  return true
}
