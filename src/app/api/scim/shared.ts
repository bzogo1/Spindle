import { NextResponse } from "next/server"

import { clientIp, createRateLimiter } from "@/lib/site-forms"
import { authenticateScimToken } from "@/lib/scim-tokens"
import { buildScimError } from "@/lib/scim"

/**
 * Shared helpers for `/api/scim/v2/*` route handlers.
 *
 * Unlike the cookie-authenticated workspace routes, SCIM endpoints are called
 * server-to-server by an IdP: there is deliberately NO same-origin check and
 * no session cookie involvement. Authentication is solely
 * `Authorization: Bearer <scim-token>` resolved through
 * {@link authenticateScimToken}.
 *
 * Rate limiting is per-IP like the rest of the API — a coarse abuse blunter,
 * not a hard guarantee (see `createRateLimiter` docs).
 */

/** SCIM sync bursts are chatty; 120 req/min/IP is generous but bounded. */
export const scimLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 })

export function scimJson(body: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(body, { status, headers })
}

export function scimError(status: number, detail: string): NextResponse {
  const headers: Record<string, string> = {}
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="scim"'
  return NextResponse.json(buildScimError(status, detail), { status, headers })
}

export type ScimAuthResult =
  { ok: true; workspaceId: string; tokenId: string } | { ok: false; response: NextResponse }

/**
 * Extracts and validates the Bearer token. Returns the resolved workspace on
 * success or a ready-to-return SCIM error response (401) on failure.
 */
export function authenticateScimRequest(request: Request): ScimAuthResult {
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim())
  const raw = match?.[1]
  if (!raw) {
    return { ok: false, response: scimError(401, "Missing SCIM bearer token.") }
  }
  const auth = authenticateScimToken(raw)
  if (!auth) {
    return { ok: false, response: scimError(401, "Invalid or revoked SCIM token.") }
  }
  return { ok: true, workspaceId: auth.workspaceId, tokenId: auth.tokenId }
}

/** Per-IP rate-limit check shared by all SCIM routes. */
export function scimRateLimited(request: Request): NextResponse | null {
  if (scimLimiter.check(clientIp(request))) return null
  return scimError(429, "Too many SCIM requests. Try again later.")
}
