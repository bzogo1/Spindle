"use client"

import {
  buildAuthorizeUrl,
  consumePendingOAuthFlow,
  createPkcePair,
  generateState,
  storePendingOAuthFlow,
} from "@/lib/auth/pkce"

/**
 * Browser auth client for `/api/auth/*`.
 *
 * Token model: the access token and refresh token live exclusively in
 * httpOnly cookies set by the API routes — JavaScript can never read them.
 * This module keeps only the *session description* (user, workspace, expiry)
 * in memory, refreshes proactively before expiry, and syncs across tabs via
 * BroadcastChannel (with a localStorage marker fallback for storage events).
 *
 * All endpoints are same-origin; `credentials: "same-origin"` is explicit so
 * the intent is obvious and a future `NEXT_PUBLIC_API_URL` split stays safe.
 */

export type ClientSessionUser = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
}

export type ClientSessionWorkspace = {
  name: string
  slug: string
}

export type ClientSession = {
  user: ClientSessionUser
  workspace: ClientSessionWorkspace | null
  sessionId: string
  /** ISO timestamp when the access token expires. */
  expiresAt: string
}

export type SignInResponse =
  { status: "ok"; session: ClientSession } | { status: "totp_required"; challenge: string }

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "email_unverified"
  | "totp_required"
  | "totp_invalid"
  | "invalid_token"
  | "invalid_request"
  | "captcha_failed"
  | "unauthenticated"
  | "forbidden"
  | "unknown_provider"
  | "oauth_failed"
  | "rate_limited"
  | "network"
  | "unknown"

export class AuthApiError extends Error {
  readonly code: AuthErrorCode
  readonly status: number
  /** Extra fields from the error envelope (e.g. `reason` for token failures). */
  readonly data: Record<string, unknown>

  constructor(
    code: AuthErrorCode,
    message: string,
    status = 0,
    data: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "AuthApiError"
    this.code = code
    this.status = status
    this.data = data
  }
}

type ApiEnvelope = { ok?: boolean; code?: string; message?: string } & Record<string, unknown>

async function api<T extends ApiEnvelope>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init.method ?? "POST",
      credentials: "same-origin",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
    const code = (payload.code as AuthErrorCode | undefined) ?? "unknown"
    const { ok: _ok, code: _code, message: _message, ...data } = payload
    throw new AuthApiError(
      code,
      payload.message ?? "Something went wrong. Please try again.",
      response.status,
      data,
    )
  }
  return payload as T
}

// ---------------------------------------------------------------------------
// Session state + cross-tab sync
// ---------------------------------------------------------------------------

let currentSession: ClientSession | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(session: ClientSession | null) => void>()
const CHANNEL_NAME = "spindle-auth"
const STORAGE_MARKER = "spindle:auth-event"

/**
 * Multiple copies of this module can coexist in one JS realm (HMR, duplicated
 * chunks, test `vi.resetModules()`). Sync events must only be applied by the
 * newest instance — otherwise every stale instance would schedule its own
 * refresh timers off a single broadcast. The channel object itself is shared
 * so stale instances don't leak BroadcastChannel listeners.
 */
type AuthClientGlobals = {
  owner?: symbol
  channel?: BroadcastChannel | null
}
const authGlobals = ((
  globalThis as { __spindleAuthClient?: AuthClientGlobals }
).__spindleAuthClient ??= {})
const instanceId = Symbol("auth-client")
authGlobals.owner = instanceId
const isOwner = () => authGlobals.owner === instanceId

function setSession(session: ClientSession | null) {
  currentSession = session
  scheduleRefresh(session)
  for (const listener of listeners) listener(session)
  broadcast({ type: session ? "session" : "signed-out", session })
}

let channel: BroadcastChannel | null = null
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  authGlobals.channel ??= new BroadcastChannel(CHANNEL_NAME)
  channel = authGlobals.channel
  channel.onmessage = (event: MessageEvent) => {
    if (!isOwner()) return
    const data = event.data as { type?: string; session?: ClientSession | null }
    if (data?.type === "signed-out") {
      currentSession = null
      for (const listener of listeners) listener(null)
    } else if (data?.type === "session" && data.session) {
      currentSession = data.session
      scheduleRefresh(data.session)
      for (const listener of listeners) listener(data.session)
    }
  }
}

function broadcast(message: { type: string; session?: ClientSession | null }) {
  channel?.postMessage(message)
  // Marker for storage-event listeners in tabs without BroadcastChannel.
  try {
    window.localStorage.setItem(STORAGE_MARKER, JSON.stringify({ ...message, at: Date.now() }))
  } catch {
    // Storage can be unavailable (private mode); BroadcastChannel still works.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!isOwner()) return
    if (event.key !== STORAGE_MARKER || !event.newValue) return
    try {
      const data = JSON.parse(event.newValue) as { type?: string; session?: ClientSession | null }
      if (data.type === "signed-out") {
        currentSession = null
        for (const listener of listeners) listener(null)
      } else if (data.type === "session" && data.session) {
        currentSession = data.session
        scheduleRefresh(data.session)
        for (const listener of listeners) listener(data.session)
      }
    } catch {
      // Ignore malformed markers.
    }
  })
}

/** Refresh this far ahead of the access-token expiry. */
const REFRESH_AHEAD_MS = 60 * 1000
/** How soon to retry a scheduled refresh that failed for a transient reason. */
const REFRESH_RETRY_MS = 15 * 1000

function runRefresh() {
  void refreshAccessToken().catch(() => {
    // Auth failures (401/invalid_token) already cleared the session inside
    // `doRefresh`, which disarmed this timer. Anything reaching here is a
    // transient failure (network, 5xx) — re-arm so the session keeps trying
    // instead of silently expiring.
    if (!currentSession) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(runRefresh, REFRESH_RETRY_MS)
  })
}

function scheduleRefresh(session: ClientSession | null) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  if (!session) return
  const delay = Math.max(Date.parse(session.expiresAt) - Date.now() - REFRESH_AHEAD_MS, 5_000)
  refreshTimer = setTimeout(runRefresh, delay)
}

export function getCurrentSession(): ClientSession | null {
  return currentSession
}

/** Adopts a session obtained outside this module (e.g. server-rendered props). */
export function acceptSession(session: ClientSession): void {
  setSession(session)
}

export function onAuthStateChange(listener: (session: ClientSession | null) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function adoptSession(payload: { session?: ClientSession }): ClientSession {
  if (!payload.session) throw new AuthApiError("unknown", "Missing session in response.")
  setSession(payload.session)
  return payload.session
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

let sessionRequest: Promise<ClientSession | null> | null = null

/**
 * Loads the session from `/api/auth/session`. The route reads the refresh
 * cookie and returns a fresh session (rotating as needed), so this works
 * after a hard reload without any client-side token storage.
 */
export function loadSession(): Promise<ClientSession | null> {
  sessionRequest ??= (async () => {
    try {
      const payload = await api<{ session?: ClientSession | null }>("/api/auth/session", {
        method: "GET",
      })
      const session = payload.session ?? null
      setSession(session)
      return session
    } catch (error) {
      if (error instanceof AuthApiError && error.code === "network") throw error
      setSession(null)
      return null
    } finally {
      sessionRequest = null
    }
  })()
  return sessionRequest
}

async function doRefresh(): Promise<ClientSession | null> {
  try {
    const payload = await api<{ session?: ClientSession }>("/api/auth/refresh")
    return adoptSession(payload)
  } catch (error) {
    if (error instanceof AuthApiError && (error.status === 401 || error.code === "invalid_token")) {
      setSession(null)
      return null
    }
    throw error
  }
}

/**
 * Single-flight refresh: concurrent callers share one in-flight request so a
 * burst of API calls can never trigger parallel refreshes (which would race
 * the refresh-token rotation and log the user out).
 */
let refreshPromise: Promise<ClientSession | null> | null = null

export function refreshAccessToken(): Promise<ClientSession | null> {
  refreshPromise ??= doRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

/** Forces a refresh regardless of the scheduled timer (e.g. after 401s). */
export async function ensureFreshSession(): Promise<ClientSession | null> {
  if (!currentSession) return loadSession()
  if (Date.parse(currentSession.expiresAt) - Date.now() > 30_000) return currentSession
  return refreshAccessToken()
}

export async function signOut(): Promise<void> {
  try {
    await api("/api/auth/logout")
  } catch {
    // Best effort: clear local state even if the revoke call fails.
  }
  setSession(null)
}

// ---------------------------------------------------------------------------
// Credential + passwordless flows
// ---------------------------------------------------------------------------

export async function signInWithPassword(input: {
  email: string
  password: string
  remember?: boolean
}): Promise<SignInResponse> {
  const payload = await api<{
    status?: string
    challenge?: string
    session?: ClientSession
  }>("/api/auth/signin", {
    body: { email: input.email, password: input.password, remember: input.remember ?? true },
  })
  if (payload.status === "totp_required" && payload.challenge) {
    return { status: "totp_required", challenge: payload.challenge }
  }
  return { status: "ok", session: adoptSession(payload) }
}

export async function verifyTotpChallenge(input: {
  challenge: string
  code: string
  remember?: boolean
}): Promise<ClientSession> {
  const payload = await api<{ session?: ClientSession }>("/api/auth/2fa/verify-login", {
    body: { challenge: input.challenge, code: input.code, remember: input.remember ?? true },
  })
  return adoptSession(payload)
}

export async function signUpWithPassword(input: {
  workspaceName: string
  email: string
  password: string
  remember?: boolean
  /** Short-lived token minted by the proof-of-work captcha flow. */
  captchaToken?: string
}): Promise<ClientSession> {
  const payload = await api<{ session?: ClientSession }>("/api/auth/signup", {
    body: {
      workspaceName: input.workspaceName,
      email: input.email,
      password: input.password,
      remember: input.remember ?? true,
      ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}),
    },
  })
  return adoptSession(payload)
}

export type PasswordlessPurpose = "signin" | "verify-email"

/** Always resolves ok — the API must not reveal whether the email exists. */
export async function requestPasswordlessLink(input: {
  email: string
  purpose?: PasswordlessPurpose
  /** In-app path to land on after the magic link is consumed. */
  next?: string
}): Promise<void> {
  await api("/api/auth/passwordless/request", {
    body: { email: input.email, purpose: input.purpose ?? "signin", next: input.next },
  })
}

export async function verifyPasswordlessLink(token: string): Promise<ClientSession> {
  const payload = await api<{ session?: ClientSession }>("/api/auth/passwordless/verify", {
    body: { token },
  })
  return adoptSession(payload)
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api("/api/auth/password/reset/request", { body: { email } })
}

export async function confirmPasswordReset(input: {
  token: string
  password: string
  /** Short-lived token minted by the proof-of-work captcha flow. */
  captchaToken?: string
}): Promise<void> {
  await api("/api/auth/password/reset/confirm", {
    body: {
      token: input.token,
      password: input.password,
      ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}),
    },
  })
}

export async function requestEmailVerification(email: string): Promise<void> {
  await api("/api/auth/passwordless/request", {
    body: { email, purpose: "verify-email" },
  })
}

export async function verifyEmailToken(token: string): Promise<void> {
  await api("/api/auth/verify-email", { body: { token } })
}

// ---------------------------------------------------------------------------
// OAuth (authorization-code + PKCE)
// ---------------------------------------------------------------------------

type OAuthProviderConfig = {
  provider: string
  clientId: string
  authorizeUrl: string
  scopes: string[]
  redirectUri: string
}

/** Fetches the public provider config and redirects to the authorize URL. */
export async function beginOAuthSignIn(input: {
  provider: string
  returnTo?: string
}): Promise<void> {
  const configResponse = await api<OAuthProviderConfig>(
    `/api/auth/oauth/${encodeURIComponent(input.provider)}`,
    { method: "GET" },
  )
  const { verifier, challenge } = await createPkcePair()
  const state = generateState()
  // Reject protocol-relative ("//host") values too — they start with "/" but
  // would navigate off-site.
  const returnTo =
    input.returnTo && input.returnTo.startsWith("/") && !input.returnTo.startsWith("//")
      ? input.returnTo
      : "/app"
  storePendingOAuthFlow({
    provider: input.provider,
    state,
    verifier,
    redirectUri: configResponse.redirectUri,
    returnTo,
    createdAt: Date.now(),
  })
  const url = buildAuthorizeUrl({
    authorizeEndpoint: configResponse.authorizeUrl,
    clientId: configResponse.clientId,
    redirectUri: configResponse.redirectUri,
    scope: configResponse.scopes.join(" "),
    state,
    challenge,
  })
  window.location.assign(url)
}

/**
 * Handles the provider redirect back to `/oauth/callback`: validates state
 * against the stored PKCE flow (CSRF check) and exchanges the code through our
 * API, which sets the auth cookies.
 */
export async function completeOAuthSignIn(input: {
  /** Optional hint; the authoritative provider comes from the stored flow. */
  provider?: string
  code: string
  state: string
}): Promise<{ session: ClientSession; returnTo: string; provider: string }> {
  const flow = consumePendingOAuthFlow(input.state)
  if (!flow || (input.provider && flow.provider !== input.provider)) {
    throw new AuthApiError("invalid_token", "Invalid or expired sign-in state. Try again.")
  }
  const payload = await api<{ session?: ClientSession }>("/api/auth/oauth/callback", {
    body: {
      provider: flow.provider,
      code: input.code,
      redirectUri: flow.redirectUri,
      codeVerifier: flow.verifier,
    },
  })
  return { session: adoptSession(payload), returnTo: flow.returnTo, provider: flow.provider }
}
