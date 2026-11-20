/**
 * Browser-side half of the WebAuthn ceremonies: converts the server's JSON
 * options into the `CredentialRequestOptions`/`CredentialCreationOptions`
 * the Credentials API wants, serializes the returned credential back into
 * the `PublicKeyCredentialJSON` shape the API parses, and runs the
 * authentication ceremony end to end.
 *
 * Browser-only — every function touches `navigator`/`window` at call time.
 * Do not import this from server code paths (it is safe to bundle, but the
 * ceremony itself only makes sense in a page).
 */

import { AuthApiError, type AuthErrorCode, type ClientSession } from "@/lib/auth/auth-client"

import type { RegistrationOptionsJSON, RequestOptionsJSON } from "./options"
import { base64urlDecode } from "./types"
import type { CredentialView } from "./types"

const AUTH_BEGIN_API = "/api/auth/webauthn/auth/begin"
const AUTH_COMPLETE_API = "/api/auth/webauthn/auth/complete"
const REGISTER_BEGIN_API = "/api/auth/webauthn/register/begin"
const REGISTER_COMPLETE_API = "/api/auth/webauthn/register/complete"

export function webauthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "credentials" in navigator &&
    typeof window.PublicKeyCredential === "function"
  )
}

function base64urlToBuffer(value: string): ArrayBuffer {
  const bytes = base64urlDecode(value)
  if (!bytes) {
    throw new AuthApiError("unknown", "The security-key challenge was malformed.")
  }
  return bytes.buffer as ArrayBuffer
}

function bufferToBase64url(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer) return ""
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

type ApiEnvelope = { ok?: boolean; code?: string; message?: string } & Record<string, unknown>

/** Same-origin POST against the `/api/auth/*` JSON envelope. */
async function postAuthJson<T extends ApiEnvelope>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AuthApiError("network", "Network error. Check your connection and try again.")
  }

  let payload: ApiEnvelope
  try {
    payload = (await response.json()) as ApiEnvelope
  } catch {
    throw new AuthApiError("unknown", "Unexpected response from the server.", response.status)
  }

  if (!response.ok || payload.ok === false) {
    throw new AuthApiError(
      (payload.code as AuthErrorCode | undefined) ?? "unknown",
      payload.message ?? "Something went wrong. Please try again.",
      response.status,
    )
  }
  return payload as T
}

/** Converts the server's `RequestOptionsJSON` into what `credentials.get` wants. */
export function toCredentialRequestOptions(options: RequestOptionsJSON): CredentialRequestOptions {
  return {
    publicKey: {
      challenge: base64urlToBuffer(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      allowCredentials: (options.allowCredentials ?? []).map((credential) => ({
        type: "public-key" as const,
        id: base64urlToBuffer(credential.id),
        ...(credential.transports?.length
          ? { transports: credential.transports as AuthenticatorTransport[] }
          : {}),
      })),
      userVerification: options.userVerification ?? "preferred",
    } as PublicKeyCredentialRequestOptions,
  }
}

/** Converts the server's registration options into what `credentials.create` wants. */
export function toCreationOptions(options: RegistrationOptionsJSON): CredentialCreationOptions {
  return {
    publicKey: {
      ...options,
      challenge: base64urlToBuffer(options.challenge),
      user: { ...options.user, id: base64urlToBuffer(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((credential) => ({
        ...credential,
        id: base64urlToBuffer(credential.id),
        type: "public-key" as const,
      })),
    } as PublicKeyCredentialCreationOptions,
  }
}

/**
 * Serializes an attestation credential into the `PublicKeyCredentialJSON`
 * shape `parseRegistrationCredential` expects: transports inside
 * `response`, binary fields base64url.
 */
export function serializeAttestationCredential(
  credential: PublicKeyCredential,
): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse
  const transports = typeof response.getTransports === "function" ? response.getTransports() : []
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
      transports,
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

/**
 * Serializes an assertion credential into the JSON shape
 * `parseAssertionCredential` expects: top-level `transports`, binary fields
 * base64url inside `response`.
 */
export function serializeAssertionCredential(
  credential: PublicKeyCredential,
): Record<string, unknown> {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: bufferToBase64url(response.userHandle),
    },
    // Assertions carry no transports (that is an attestation concept); the
    // parser defaults the missing field to [].
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

/**
 * Runs the assertion ceremony shared by security-key and passkey sign-in:
 * `POST auth/begin` → `navigator.credentials.get()` → `POST auth/complete`.
 *
 * The begin route decides discoverability: anonymous callers get
 * `allowCredentials: []` (any resident/passkey credential for this rpId —
 * the username-less passkey flow), signed-in callers get their registered
 * credential ids. One ceremony therefore covers both UX entry points.
 *
 * Resolves with the `ClientSession` on success; the auth cookies were already
 * set by the complete route. Rejects with:
 *  - `DOMException` `NotAllowedError` when the user dismisses the prompt
 *    (callers should treat this as a silent cancel, not an error);
 *  - `AuthApiError` for API/envelope failures (`invalid_assertion`,
 *    `invalid_challenge`, rate limits, network).
 */
async function runAssertionCeremony(): Promise<ClientSession> {
  const begin = await postAuthJson<{
    challengeId?: string
    options?: RequestOptionsJSON
  }>(AUTH_BEGIN_API)
  if (!begin.challengeId || !begin.options) {
    throw new AuthApiError("unknown", "The security-key challenge response was incomplete.")
  }

  const credential = (await navigator.credentials.get(
    toCredentialRequestOptions(begin.options),
  )) as PublicKeyCredential | null
  if (!credential) {
    // `get()` resolving null is the same user-cancel outcome as the
    // NotAllowedError rejection — surface it identically so callers stay silent.
    throw new DOMException("The security key prompt was dismissed.", "NotAllowedError")
  }

  const complete = await postAuthJson<{ session?: ClientSession }>(AUTH_COMPLETE_API, {
    challengeId: begin.challengeId,
    credential: serializeAssertionCredential(credential),
  })
  if (!complete.session) {
    throw new AuthApiError("unknown", "Missing session in response.")
  }
  return complete.session
}

/**
 * Username-less passkey/security-key sign-in. For signed-out users this IS
 * the discoverable-credential ceremony: auth/begin returns an empty
 * allowCredentials list, so the authenticator offers any resident
 * credential registered for this site — no username required.
 *
 * Note: non-resident (non-discoverable) security keys CANNOT answer this
 * ceremony — WebAuthn gives the browser no way to enumerate credentials
 * that aren't stored on the authenticator, so `allowCredentials` must be
 * empty and only resident keys/passkeys can respond. Those keys still work
 * in session-bound ceremonies where the server lists their credential ids.
 */
export function signInWithPasskey(): Promise<ClientSession> {
  return runAssertionCeremony()
}

/**
 * Shared registration ceremony: `POST register/begin` →
 * `navigator.credentials.create()` → `POST register/complete`. `passkey`
 * selects the discoverable-credential flavour (`residentKey: "required"`,
 * stored `kind: "passkey"`); `false` is the plain security-key flow
 * (`residentKey: "preferred"`). Resolves with the stored credential's
 * public view.
 *
 * Requires an active session (the auth cookies are sent same-origin).
 * Rejects with `AuthApiError` on API failures and `DOMException`
 * `NotAllowedError` when the user dismisses the prompt.
 */
async function runRegistrationCeremony(passkey: boolean, label?: string): Promise<CredentialView> {
  const begin = await postAuthJson<{
    challengeId?: string
    options?: RegistrationOptionsJSON
  }>(REGISTER_BEGIN_API, { passkey })
  if (!begin.challengeId || !begin.options) {
    throw new AuthApiError("unknown", "The registration challenge response was incomplete.")
  }

  const credential = (await navigator.credentials.create(
    toCreationOptions(begin.options),
  )) as PublicKeyCredential | null
  if (!credential) {
    throw new DOMException("The authenticator prompt was dismissed.", "NotAllowedError")
  }

  const complete = await postAuthJson<{ credential?: CredentialView }>(REGISTER_COMPLETE_API, {
    challengeId: begin.challengeId,
    credential: serializeAttestationCredential(credential),
    label: label?.trim() || undefined,
  })
  if (!complete.credential) {
    throw new AuthApiError("unknown", "Missing credential in response.")
  }
  return complete.credential
}

/**
 * Registers a non-resident security key for the signed-in user
 * (`residentKey: "preferred"`; stored `kind: "security-key"`).
 */
export function registerSecurityKey(label?: string): Promise<CredentialView> {
  return runRegistrationCeremony(false, label)
}

/**
 * Runs the passkey registration ceremony for the signed-in user:
 * `POST register/begin {passkey:true}` → `navigator.credentials.create()` →
 * `POST register/complete`. The begin route answers with
 * `residentKey: "required"` options, so the credential is discoverable and
 * can later answer the username-less sign-in above. Resolves with the
 * stored credential's public view (`kind: "passkey"`).
 */
export function registerPasskey(label?: string): Promise<CredentialView> {
  return runRegistrationCeremony(true, label)
}
