/**
 * PKCE (RFC 7636) helpers for the OAuth-style authorization-code flow.
 *
 * Isomorphic: uses WebCrypto only, so the same module runs in the browser
 * (generating the verifier before redirecting to the provider) and in tests.
 * The code verifier is a secret — it must never leave the client until the
 * token exchange, and it is stored in `sessionStorage` (tab-scoped) rather
 * than `localStorage` so it cannot leak into persistent storage or other tabs.
 */

const STORAGE_KEY = "spindle:oauth-pending"
const VERIFIER_BYTES = 64 // 512 bits of entropy -> 86-char base64url verifier
const STATE_BYTES = 16
const CHALLENGE_METHOD = "S256"

export type PkcePair = {
  verifier: string
  challenge: string
}

export type PendingOAuthFlow = {
  provider: string
  state: string
  verifier: string
  redirectUri: string
  /** Internal path the user should land on after the exchange. */
  returnTo: string
  createdAt: number
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** 43–128 char unreserved-string verifier per RFC 7636 §4.1. */
export function generateCodeVerifier(): string {
  return bytesToBase64Url(randomBytes(VERIFIER_BYTES))
}

/** `BASE64URL(SHA256(ASCII(verifier)))` per RFC 7636 §4.2. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return bytesToBase64Url(new Uint8Array(digest))
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = generateCodeVerifier()
  return { verifier, challenge: await codeChallengeS256(verifier) }
}

export function generateState(): string {
  return bytesToBase64Url(randomBytes(STATE_BYTES))
}

export type AuthorizeUrlParams = {
  authorizeEndpoint: string
  clientId: string
  redirectUri: string
  scope?: string
  state: string
  challenge: string
  /** Extra provider-specific params (e.g. `prompt`, `access_type`). */
  extra?: Record<string, string>
}

/** Builds the provider authorization URL with the PKCE challenge attached. */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(params.authorizeEndpoint)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("state", params.state)
  url.searchParams.set("code_challenge", params.challenge)
  url.searchParams.set("code_challenge_method", CHALLENGE_METHOD)
  if (params.scope) url.searchParams.set("scope", params.scope)
  for (const [key, value] of Object.entries(params.extra ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Persists the pending flow before the browser leaves for the provider.
 * `sessionStorage` keeps the verifier scoped to this tab and cleared on close.
 */
export function storePendingOAuthFlow(flow: PendingOAuthFlow): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(flow))
}

export function readPendingOAuthFlow(): PendingOAuthFlow | null {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PendingOAuthFlow>
    if (
      typeof parsed.provider !== "string" ||
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.redirectUri !== "string"
    ) {
      return null
    }
    return {
      provider: parsed.provider,
      state: parsed.state,
      verifier: parsed.verifier,
      redirectUri: parsed.redirectUri,
      returnTo: typeof parsed.returnTo === "string" ? parsed.returnTo : "/",
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}

/**
 * Reads and clears the pending flow. Returns null when the stored `state`
 * does not match the callback `state` — callers must treat that as a CSRF
 * failure and abort the exchange.
 */
export function consumePendingOAuthFlow(callbackState: string): PendingOAuthFlow | null {
  const flow = readPendingOAuthFlow()
  storage()?.removeItem(STORAGE_KEY)
  if (!flow || flow.state !== callbackState) return null
  return flow
}

/** Pending flows older than this are treated as abandoned logins. */
export const PENDING_OAUTH_MAX_AGE_MS = 10 * 60 * 1000
