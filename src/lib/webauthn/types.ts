/**
 * Shared types and encoding helpers for the hand-rolled WebAuthn
 * implementation in `src/lib/webauthn`.
 *
 * The client↔server JSON shape mirrors the browser's
 * `PublicKeyCredential.toJSON()` output (the serialization used by
 * `@simplewebauthn` and the WebAuthn spec's "JSON serialization" note): every
 * binary field is base64url-encoded without padding.
 */

export type WebAuthnCredentialJSON = {
  /** base64url credential id (== `rawId`). */
  id: string
  rawId: string
  type: "public-key"
  response: Record<string, unknown>
  authenticatorAttachment?: string | null
  clientExtensionResults?: Record<string, unknown>
  transports?: string[]
}

export type ChallengePurpose = "register" | "authenticate"

/**
 * What the credential is FOR, from the user's perspective:
 *  - "security-key": a roaming/platform authenticator used as a second factor
 *    style credential (registered with `residentKey: "preferred"`).
 *  - "passkey": a discoverable (resident) credential registered with
 *    `residentKey: "required"` — it can answer username-less sign-in because
 *    the authenticator stores the user handle and credential id itself.
 *
 * Both kinds share ONE credential store and ONE assertion path; `kind` is
 * only a management/UI label recorded at registration time (the attestation
 * itself does not reveal resident-key-ness).
 */
export type CredentialKind = "security-key" | "passkey"

export const DEFAULT_CREDENTIAL_KIND: CredentialKind = "security-key"

export type StoredChallenge = {
  id: string
  userId: string
  purpose: ChallengePurpose
  /**
   * Registration flavour issued with the challenge (register purpose only):
   * "passkey" challenges were created with `residentKey: "required"` options,
   * so register/complete persists the credential as a passkey. Absent on
   * authenticate challenges and on challenges issued before this field
   * existed (treated as "security-key").
   */
  kind?: CredentialKind
  /** base64url challenge bytes sent to the client. */
  challenge: string
  createdAt: string
  expiresAt: string
  consumedAt: string | null
}

export type StoredCredential = {
  /** base64url credential id. Globally unique (authenticator-generated). */
  id: string
  userId: string
  /** User-facing label, e.g. "YubiKey 5C". */
  label: string
  /** base64url of the raw COSE_Key bytes from the attestation. */
  publicKeyCose: string
  /** Authenticator signature counter at last successful use. */
  counter: number
  transports: string[]
  /** base64url AAGUID when present (16 bytes). */
  aaguid: string | null
  /** "security-key" | "passkey" — see CredentialKind. */
  kind: CredentialKind
  createdAt: string
  lastUsedAt: string
  revokedAt: string | null
}

/** Public (non-secret) view of a stored credential for API responses. */
export type CredentialView = {
  id: string
  label: string
  kind: CredentialKind
  transports: string[]
  createdAt: string
  lastUsedAt: string
}

export function toCredentialView(credential: StoredCredential): CredentialView {
  return {
    id: credential.id,
    label: credential.label,
    // Defensive: records predating `kind` surface as security keys.
    kind: credential.kind ?? DEFAULT_CREDENTIAL_KIND,
    transports: credential.transports,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
  }
}

export function base64urlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

/** Decodes base64url (padding optional). Returns null on malformed input. */
export function base64urlDecode(input: string): Uint8Array | null {
  if (typeof input !== "string" || input.length === 0) return null
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null
  try {
    const padded = input.replaceAll("-", "+").replaceAll("_", "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function base64urlDecodeString(input: string): string | null {
  const bytes = base64urlDecode(input)
  if (!bytes) return null
  return new TextDecoder().decode(bytes)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Non-2xx WebAuthn failures surfaced to route handlers as 400s. */
export class WebAuthnError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "WebAuthnError"
    this.code = code
  }
}

export function webauthnFail(code: string, message: string): never {
  throw new WebAuthnError(code, message)
}
