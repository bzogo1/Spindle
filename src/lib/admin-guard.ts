import type { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { isAdminEmail } from "@/lib/admin"
import { getAuthBackend } from "@/lib/auth/backend"
import { ACCESS_COOKIE, accessTokenFromRequest, fail, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { verifyAuthToken } from "@/lib/auth/token-codec"

/**
 * Server-side admin session resolution shared by the `/app/admin` layout
 * (cookie-based, for pages) and `/api/admin/*` route handlers
 * (request-based).
 *
 * Identity sources, in order:
 *  1. A verified `spindle_at` access token -> `getUserById` -> the user's
 *     stored email (never the token claim alone — the backend row is the
 *     source of truth, same as GET /api/auth/session).
 *  2. The `spindle_mock_session` cookie, but ONLY when `NEXT_PUBLIC_MOCK_AUTH=1`
 *     — the cookie is unsigned base64 JSON and must never be trusted in real
 *     mode.
 *
 * The resolved email is then checked against `isAdminEmail` (ADMIN_EMAILS env
 * seam — see lib/admin.ts). Everything here is read-only against the auth
 * backend; admin authorization never trusts client-supplied claims.
 */

async function emailForAccessToken(token: string): Promise<string | null> {
  const payload = verifyAuthToken(token, "access")
  if (!payload) return null
  const user = await getAuthBackend().getUserById(payload.uid)
  return user?.email ?? null
}

function emailFromMockCookie(raw: string | null | undefined): string | null {
  if (!mockAuthEnabled || !raw) return null
  return decodeMockSession(raw)?.user.email ?? null
}

/**
 * Page/layout guard: returns the caller's email when they are an admin,
 * otherwise `null`. Callers should `notFound()` on `null` so non-admins see
 * the same 404 as any other missing route (no admin-surface enumeration).
 */
export async function getAdminEmail(): Promise<string | null> {
  const store = await cookies()
  const access = store.get(ACCESS_COOKIE)?.value
  let email = access ? await emailForAccessToken(access) : null
  if (!email) email = emailFromMockCookie(store.get(MOCK_SESSION_COOKIE)?.value)
  return isAdminEmail(email) ? email : null
}

/**
 * API guard: resolves the caller and enforces admin access.
 *
 * Returns `{ email }` for admins, or a ready-to-return `NextResponse`:
 *   - 401 `unauthorized` when there is no resolvable session,
 *   - 403 `forbidden` when the session is valid but not an admin.
 *
 * Usage:
 * ```ts
 * const admin = await requireAdmin(request)
 * if (admin instanceof NextResponse) return admin
 * // admin.email is the verified admin email
 * ```
 */
export async function requireAdmin(request: Request): Promise<{ email: string } | NextResponse> {
  const access = accessTokenFromRequest(request)
  let email: string | null = null
  if (access) {
    const user = await getAuthBackend().getUserById(access.uid)
    email = user?.email ?? null
  }
  if (!email) email = emailFromMockCookie(readCookie(request, MOCK_SESSION_COOKIE))

  if (!email) return fail(401, "unauthorized", "Sign in required.")
  if (!isAdminEmail(email)) {
    return fail(403, "forbidden", "Admin access required.")
  }
  return { email }
}
