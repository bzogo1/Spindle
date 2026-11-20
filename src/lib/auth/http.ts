import { NextResponse } from "next/server"

import { getServerEnv } from "@/lib/env.server"
import { verifyAuthToken, type AccessTokenPayload } from "@/lib/auth/token-codec"
import type { TokenPair } from "@/lib/auth/backend"

/**
 * Shared helpers for `/api/auth/*` route handlers: JSON envelopes, same-origin
 * enforcement for mutating requests, httpOnly cookie plumbing, and access-token
 * extraction.
 *
 * Cookie strategy (documented in README notes / prisma/AUTH-SCHEMA.md):
 *  - `spindle_at` — signed access token, httpOnly, Path=/, session cookie
 *    (no Max-Age/expires). It must survive hard reloads within the browser
 *    session: an expiring cookie would be lost while the refresh cookie is
 *    scoped to Path=/api/auth and never reaches page requests, so guards
 *    (proxy.ts, (app)/layout.tsx) would bounce a still-valid session to
 *    sign-in. The JWT's own `exp` is still enforced where tokens are verified
 *    for real work; guards use `verifyAuthTokenIgnoreExpiry` as a coarse gate.
 *    httpOnly so XSS cannot exfiltrate it; the client never reads it directly
 *    and instead calls `/api/auth/session` / `/api/auth/refresh`.
 *  - `spindle_rt` — opaque refresh token, httpOnly, Path=/api/auth (scoped so
 *    it is only sent to auth endpoints), rotated on every use.
 *  - "Keep me signed in" off => the refresh cookie is a session cookie (no
 *    Max-Age); the access cookie is always session-scoped.
 */

export const ACCESS_COOKIE = "spindle_at"
export const REFRESH_COOKIE = "spindle_rt"

const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

export function ok(data: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: true, ...data })
}

export function fail(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status })
}

/**
 * CSRF guard for cookie-authenticated POSTs: when the browser sends an Origin
 * (or Sec-Fetch-Site) it must match this host. Requests without either header
 * (non-browser clients) are allowed through — they cannot carry the victim's
 * cookies anyway unless they already have them.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false

  const origin = request.headers.get("origin")
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

function cookieBase() {
  const secure = getServerEnv().NODE_ENV === "production"
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" }
}

/** Writes the auth cookies onto a response. */
export function applyAuthCookies(
  response: NextResponse,
  tokens: TokenPair,
  options: { remember: boolean },
): NextResponse {
  const base = cookieBase()
  // The access cookie is always a session cookie (no Max-Age/expires) so it
  // persists across hard reloads for the browser session; only the refresh
  // cookie carries the "keep me signed in" persistence.
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, path: "/" })
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: "/api/auth",
    ...(options.remember ? { maxAge: REFRESH_COOKIE_MAX_AGE } : {}),
  })
  return response
}

export function clearAuthCookies(response: NextResponse): NextResponse {
  const base = cookieBase()
  response.cookies.set(ACCESS_COOKIE, "", { ...base, path: "/", maxAge: 0 })
  response.cookies.set(REFRESH_COOKIE, "", { ...base, path: "/api/auth", maxAge: 0 })
  return response
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

/**
 * Verifies the `spindle_at` cookie and returns its payload, or null when the
 * token is missing, forged, or expired. Callers still need a backend lookup
 * (`getUserById`) for a fully hydrated session.
 */
export function accessTokenFromRequest(request: Request): AccessTokenPayload | null {
  const token = readCookie(request, ACCESS_COOKIE)
  if (!token) return null
  return verifyAuthToken(token, "access")
}

export function refreshTokenFromRequest(request: Request): string | null {
  return readCookie(request, REFRESH_COOKIE)
}
