/**
 * Parsing and verification of the `clientDataJSON` byte string that both
 * WebAuthn ceremonies embed in their response.
 *
 * `clientDataJSON` is produced by the browser and contains:
 *   { type: "webauthn.create" | "webauthn.get",
 *     challenge: <base64url challenge>,
 *     origin: <full origin, e.g. "https://app.example.com">,
 *     crossOrigin?: boolean }
 *
 * Verification is deliberately strict: exact origin match against the
 * request's own origin and byte-equal challenge. Anything looser would let a
 * ceremony captured on one origin be replayed on another.
 */

import { timingSafeEqual } from "node:crypto"

import { base64urlDecode, isRecord, WebAuthnError } from "./types"

export const CLIENT_DATA_TYPE_CREATE = "webauthn.create"
export const CLIENT_DATA_TYPE_GET = "webauthn.get"

export type ClientData = {
  type: string
  challenge: string
  origin: string
  crossOrigin: boolean
}

export function parseClientDataJSON(bytes: Uint8Array): ClientData {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new WebAuthnError("invalid_client_data", "clientDataJSON is not valid JSON.")
  }
  if (!isRecord(parsed)) {
    throw new WebAuthnError("invalid_client_data", "clientDataJSON is not an object.")
  }
  const { type, challenge, origin, crossOrigin } = parsed
  if (typeof type !== "string" || typeof challenge !== "string" || typeof origin !== "string") {
    throw new WebAuthnError("invalid_client_data", "clientDataJSON is missing required fields.")
  }
  return {
    type,
    challenge,
    origin,
    crossOrigin: crossOrigin === true,
  }
}

function safeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Asserts the clientDataJSON matches this ceremony: correct `type`,
 * byte-equal challenge, and exact origin match. Returns the parsed data.
 */
export function verifyClientData(input: {
  clientDataJSON: Uint8Array
  expectedType: string
  /** base64url challenge exactly as issued by the challenge store. */
  expectedChallenge: string
  /** Full origin the ceremony must have run on (e.g. "https://app.example.com"). */
  expectedOrigin: string
}): ClientData {
  const data = parseClientDataJSON(input.clientDataJSON)

  if (data.type !== input.expectedType) {
    throw new WebAuthnError(
      "wrong_ceremony_type",
      `Expected a ${input.expectedType} ceremony but got ${data.type}.`,
    )
  }

  const presented = base64urlDecode(data.challenge)
  const expected = base64urlDecode(input.expectedChallenge)
  if (!presented || !expected || !safeEqualBytes(presented, expected)) {
    throw new WebAuthnError("challenge_mismatch", "The WebAuthn challenge does not match.")
  }

  if (data.origin !== input.expectedOrigin) {
    throw new WebAuthnError("origin_mismatch", "The WebAuthn origin does not match this site.")
  }

  return data
}
