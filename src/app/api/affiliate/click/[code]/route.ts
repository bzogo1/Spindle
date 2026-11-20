import { NextResponse } from "next/server"

import { recordClick } from "@/lib/affiliate"
import { authRateLimited, clientIp } from "@/lib/auth-endpoint-rate-limit"
import { fail, ok } from "@/lib/auth/http"
import { createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ code: string }> }

/**
 * GET /api/affiliate/click/[code] — public affiliate link tracker.
 *
 * This is the target of every affiliate share link. It records a click
 * against the `AFF-XXXX-XXXX` code (only `active` affiliates accrue clicks —
 * unknown, pending, suspended, and rejected codes all 404 identically so
 * the endpoint cannot be used to enumerate the program) and then:
 *
 *  - redirects (302) to `?to=<internal path>` when a safe same-site target
 *    is supplied — `//host` protocol-relative URLs, backslashes, and
 *    control characters are rejected (e.g. `/\evil.com` resolves
 *    cross-origin under `new URL()`);
 *  - otherwise returns `{ ok, tracked }` JSON for API-style callers.
 *
 * Rate limited per IP (30/min). The store is the in-memory dev seam in
 * `src/lib/affiliate.ts`.
 */

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 })

function safeRedirectTarget(request: Request): string | null {
  const target = new URL(request.url).searchParams.get("to")
  if (!target) return null
  // Internal paths only: must start with "/" but not "//" (protocol-relative).
  if (!target.startsWith("/") || target.startsWith("//")) return null
  // Reject backslashes and ASCII control characters: WHATWG URL parsing
  // treats `\` as `/` in special schemes, so `/\evil.com`, `/\tevil.com`,
  // and `/\//evil.com` would resolve to a cross-origin URL despite the
  // leading "/". Encoded control chars (%09, %0a, ...) survive
  // searchParams decoding, so this also blocks `/%5Cevil.com`-style tricks.
  for (const ch of target) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === "\\" || code < 0x20 || code === 0x7f) return null
  }
  // Belt and suspenders: resolve and require the result to stay on the
  // request's own origin.
  const resolved = new URL(target, request.url)
  if (resolved.origin !== new URL(request.url).origin) return null
  return target
}

export async function GET(request: Request, context: RouteContext) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const { code } = await context.params
  const click = recordClick(code, {
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: clientIp(request),
  })
  if (!click) {
    return fail(404, "not_found", "Unknown affiliate link.")
  }

  const target = safeRedirectTarget(request)
  if (target) {
    return NextResponse.redirect(new URL(target, request.url), 302)
  }
  return ok({ tracked: true, code: click.code })
}
