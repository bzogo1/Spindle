import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/http"
import { mockAuthEnabled } from "@/lib/auth/mock-session"
import { verifyAuthTokenIgnoreExpiry } from "@/lib/auth/token-codec"

/**
 * Coarse page guard for the real-session app routes (`/dashboard`, `/app`,
 * `/projects`). It runs before render and answers one question only: does the
 * visitor plausibly hold a session?
 *
 *  - Mock mode (`NEXT_PUBLIC_MOCK_AUTH=1`): skipped entirely — the `(app)`
 *    layout's mock-cookie gate handles that world.
 *  - Real mode: allowed when a `spindle_rt` refresh cookie is present OR the
 *    `spindle_at` access cookie carries a genuine signature. Expiry is
 *    intentionally ignored (`verifyAuthTokenIgnoreExpiry`): an expired token
 *    still proves a real session exists, and `AuthSessionProvider` refreshes
 *    it client-side via `/api/auth/session`. Anything else is redirected to
 *    the sign-in page with a sanitized `next` return path
 *    (`/sign-in?next=<path+search>`).
 *
 * This is a gate, not an authorization check — protected data access still
 * goes through the API/backend.
 */
export function proxy(request: NextRequest) {
  if (mockAuthEnabled) return NextResponse.next()

  const hasRefresh = request.cookies.has(REFRESH_COOKIE)
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value
  const hasSignedAccess =
    typeof accessToken === "string" && verifyAuthTokenIgnoreExpiry(accessToken, "access") !== null

  if (hasRefresh || hasSignedAccess) return NextResponse.next()

  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const safeNext = target.startsWith("/") && !target.startsWith("//") ? target : "/"

  const url = new URL("/sign-in", request.url)
  url.searchParams.set("next", safeNext)
  return NextResponse.redirect(url)
}

export const config = {
  // `_next/static`, `_next/image`, and `favicon.ico` never match these
  // prefixes, so no negative pattern is needed.
  matcher: ["/dashboard/:path*", "/app/:path*", "/projects/:path*"],
}
