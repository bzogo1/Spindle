/**
 * Builds the `PublicKeyCredentialCreationOptions` /
 * `PublicKeyCredentialRequestOptions` JSON handed to the browser.
 *
 * The shapes follow the WebAuthn "JSON serialization": binary fields are
 * base64url strings that the client converts back to ArrayBuffers before
 * calling `navigator.credentials.create()` / `.get()`.
 */

import { base64urlEncode } from "./types"
import type { StoredCredential } from "./types"

export const DEFAULT_TIMEOUT_MS = 60_000

/** COSE algorithm identifiers we accept (ES256 only — see cose.ts). */
export const PUB_KEY_CRED_PARAMS = [{ type: "public-key", alg: -7 }] as const

export type CredentialDescriptorJSON = {
  type: "public-key"
  id: string
  transports?: string[]
}

export function toCredentialDescriptors(
  credentials: StoredCredential[],
): CredentialDescriptorJSON[] {
  return credentials.map((credential) => ({
    type: "public-key",
    id: credential.id,
    ...(credential.transports.length > 0 ? { transports: credential.transports } : {}),
  }))
}

export type ResidentKeyRequirement = "preferred" | "required"
export type UserVerificationRequirement = "preferred" | "required"

export type RegistrationOptionsJSON = {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: readonly { type: "public-key"; alg: number }[]
  timeout: number
  excludeCredentials: CredentialDescriptorJSON[]
  authenticatorSelection: {
    residentKey: ResidentKeyRequirement
    userVerification: UserVerificationRequirement
    requireResidentKey: boolean
  }
  attestation: "none"
  extensions?: Record<string, never>
}

export function buildRegistrationOptions(input: {
  challenge: string
  rpId: string
  rpName: string
  userId: string
  userName: string
  userDisplayName: string
  excludeCredentials?: CredentialDescriptorJSON[]
  timeoutMs?: number
  /**
   * "required" asks the authenticator for a discoverable (resident) credential
   * — the passkey flow, which enables username-less sign-in. "preferred"
   * (default) lets non-resident security keys register too. When "required",
   * `requireResidentKey` is also set for legacy authenticators that still
   * honour the deprecated flag.
   */
  residentKey?: ResidentKeyRequirement
  /** UV preference; passkeys default to "preferred" (platform PIN/biometric optional-but-allowed). */
  userVerification?: UserVerificationRequirement
}): RegistrationOptionsJSON {
  const residentKey = input.residentKey ?? "preferred"
  const userVerification = input.userVerification ?? "preferred"
  return {
    challenge: input.challenge,
    rp: { name: input.rpName, id: input.rpId },
    // The user handle is the UTF-8 bytes of our user id, base64url'd — this
    // is what makes credentials discoverable (resident-key capable) and what
    // auth/complete cross-checks against the assertion's userHandle.
    user: {
      id: base64urlEncode(input.userId),
      name: input.userName,
      displayName: input.userDisplayName,
    },
    pubKeyCredParams: PUB_KEY_CRED_PARAMS,
    timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    excludeCredentials: input.excludeCredentials ?? [],
    authenticatorSelection: {
      residentKey,
      userVerification,
      requireResidentKey: residentKey === "required",
    },
    attestation: "none",
  }
}

export type RequestOptionsJSON = {
  challenge: string
  rpId: string
  timeout: number
  allowCredentials: CredentialDescriptorJSON[]
  userVerification: "preferred"
}

export function buildRequestOptions(input: {
  challenge: string
  rpId: string
  allowCredentials?: CredentialDescriptorJSON[]
  timeoutMs?: number
}): RequestOptionsJSON {
  return {
    challenge: input.challenge,
    rpId: input.rpId,
    timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // An empty allowCredentials list asks the authenticator for any
    // discoverable credential registered for this rpId.
    allowCredentials: input.allowCredentials ?? [],
    userVerification: "preferred",
  }
}
