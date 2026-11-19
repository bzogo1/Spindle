import { clientEnv } from "@/lib/env"

/**
 * Mock session for the authenticated `(app)` route group.
 *
 * This is a backend-free stand-in for the real session work tracked in
 * DEV-27. The session lives in a plain cookie so the `(app)` layout can guard
 * routes on the server; the provider interface (`user`, `workspace`, `status`,
 * `signIn`, `signOut`) mirrors what a server session will return so the mock
 * can be swapped without touching the shell.
 *
 * Everything is gated behind `NEXT_PUBLIC_MOCK_AUTH=1`. When the flag is unset
 * the `(app)` routes are not reachable.
 */

export const MOCK_SESSION_COOKIE = "spindle_mock_session"
export const MOCK_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/** Where the marketing site sends signed-out visitors; `?signin=1` opens the auth dialog. */
export const SIGN_IN_PATH = "/?signin=1"
/** Entry point of the mocked app; `/app` redirects here. */
export const APP_ROOT_PATH = "/dashboard"
export const APP_DASHBOARD_PATH = "/dashboard"

export const mockAuthEnabled = clientEnv.NEXT_PUBLIC_MOCK_AUTH === "1"

export type MockSessionUser = {
  name: string
  email: string
}

export type MockSessionWorkspace = {
  name: string
  slug: string
}

export type MockSessionData = {
  user: MockSessionUser
  workspace: MockSessionWorkspace
  signedInAt: string
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Serializes a session into the cookie value (base64url JSON). */
export function encodeMockSession(session: MockSessionData): string {
  return toBase64Url(JSON.stringify(session))
}

function isMockSessionData(value: unknown): value is MockSessionData {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<MockSessionData>
  return (
    typeof candidate.user?.name === "string" &&
    typeof candidate.user?.email === "string" &&
    typeof candidate.workspace?.name === "string" &&
    typeof candidate.workspace?.slug === "string" &&
    typeof candidate.signedInAt === "string"
  )
}

/** Parses a cookie value back into a session; returns null for anything malformed. */
export function decodeMockSession(value: string | undefined | null): MockSessionData | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(value))
    return isMockSessionData(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Reads the session cookie from the current document. Client-only; server
 * code should read the cookie through `next/headers` and `decodeMockSession`.
 */
export function readMockSessionCookie(): MockSessionData | null {
  if (typeof document === "undefined") return null
  const prefix = `${MOCK_SESSION_COOKIE}=`
  const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix))
  return decodeMockSession(entry?.slice(prefix.length))
}

/** Writes the mock session cookie. Client-only. */
export function persistMockSession(session: MockSessionData): void {
  if (typeof document === "undefined") return
  document.cookie = `${MOCK_SESSION_COOKIE}=${encodeMockSession(session)}; Path=/; Max-Age=${MOCK_SESSION_MAX_AGE_SECONDS}; SameSite=Lax`
}

/** Removes the mock session cookie. Client-only. */
export function clearMockSessionCookie(): void {
  if (typeof document === "undefined") return
  document.cookie = `${MOCK_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}
