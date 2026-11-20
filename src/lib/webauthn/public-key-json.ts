/**
 * Parsing of the `PublicKeyCredentialJSON` shape produced by
 * `PublicKeyCredential.toJSON()` on the client and posted back to the
 * register/complete and auth/complete routes.
 *
 * Every binary field arrives base64url-encoded (no padding) per the WebAuthn
 * "JSON serialization" convention shared with `@simplewebauthn`.
 */

import { base64urlDecode, isRecord, WebAuthnError } from "./types"

export type RegistrationCredentialJSON = {
  id: string
  rawId: string
  transports: string[]
  clientDataJSON: Uint8Array
  attestationObject: Uint8Array
}

export type AssertionCredentialJSON = {
  id: string
  rawId: string
  transports: string[]
  clientDataJSON: Uint8Array
  authenticatorData: Uint8Array
  signature: Uint8Array
  userHandle: Uint8Array | null
}

function b64Field(record: Record<string, unknown>, key: string): Uint8Array {
  const value = record[key]
  if (typeof value !== "string") {
    throw new WebAuthnError("invalid_credential", `Credential is missing ${key}.`)
  }
  const decoded = base64urlDecode(value)
  if (!decoded || decoded.length === 0) {
    throw new WebAuthnError("invalid_credential", `Credential ${key} is malformed.`)
  }
  return decoded
}

function idFields(record: Record<string, unknown>): { id: string; rawId: string } {
  const { id, rawId } = record
  if (typeof id !== "string" || typeof rawId !== "string" || id.length === 0) {
    throw new WebAuthnError("invalid_credential", "Credential is missing id/rawId.")
  }
  // `id` and `rawId` are the same credential id in two serializations; both
  // must decode and agree, otherwise the payload is internally inconsistent.
  const idBytes = base64urlDecode(id)
  const rawBytes = base64urlDecode(rawId)
  if (!idBytes || !rawBytes || idBytes.length !== rawBytes.length) {
    throw new WebAuthnError("invalid_credential", "Credential id/rawId are malformed.")
  }
  for (let i = 0; i < idBytes.length; i += 1) {
    if (idBytes[i] !== rawBytes[i]) {
      throw new WebAuthnError("invalid_credential", "Credential id and rawId disagree.")
    }
  }
  return { id, rawId }
}

function transportsOf(record: Record<string, unknown>): string[] {
  const raw = record.transports
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    throw new WebAuthnError("invalid_credential", "Credential transports are malformed.")
  }
  return raw as string[]
}

function responseOf(credential: Record<string, unknown>): Record<string, unknown> {
  const response = credential.response
  if (!isRecord(response)) {
    throw new WebAuthnError("invalid_credential", "Credential is missing a response object.")
  }
  return response
}

function parseBase(credential: unknown): {
  top: Record<string, unknown>
  response: Record<string, unknown>
  ids: { id: string; rawId: string }
  transports: string[]
} {
  if (!isRecord(credential)) {
    throw new WebAuthnError("invalid_credential", "Credential payload must be an object.")
  }
  if (credential.type !== "public-key") {
    throw new WebAuthnError("invalid_credential", "Credential type must be public-key.")
  }
  return {
    top: credential,
    response: responseOf(credential),
    ids: idFields(credential),
    transports: transportsOf(credential),
  }
}

export function parseRegistrationCredential(value: unknown): RegistrationCredentialJSON {
  const base = parseBase(value)
  // `navigator.credentials.create().toJSON()` puts transports inside
  // `response`; older serializations hoist them to the top level.
  const raw = base.response.transports
  const responseTransports = Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : []
  return {
    ...base.ids,
    transports: responseTransports.length > 0 ? responseTransports : base.transports,
    clientDataJSON: b64Field(base.response, "clientDataJSON"),
    attestationObject: b64Field(base.response, "attestationObject"),
  }
}

export function parseAssertionCredential(value: unknown): AssertionCredentialJSON {
  const base = parseBase(value)
  const userHandleRaw = base.response.userHandle
  let userHandle: Uint8Array | null = null
  if (typeof userHandleRaw === "string" && userHandleRaw.length > 0) {
    userHandle = base64urlDecode(userHandleRaw)
  }
  return {
    ...base.ids,
    transports: base.transports,
    clientDataJSON: b64Field(base.response, "clientDataJSON"),
    authenticatorData: b64Field(base.response, "authenticatorData"),
    signature: b64Field(base.response, "signature"),
    userHandle,
  }
}
