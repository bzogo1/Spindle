import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { checkPasswordBreach } from "@/lib/auth/password-breach"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Generous limit: this is a read-only heuristic check, but it still runs a
 * non-trivial scan so it is rate-limited per IP like the other auth endpoints.
 */
const limiter = createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 })

/**
 * POST /api/auth/password/breach — body `{ password: string }`.
 *
 * Runs the LOCAL breach check (denylist + heuristics, no external APIs) and
 * returns `{ breached, reasons, severity }`. Intended for client-side
 * pre-flight warnings; the signup and password-reset endpoints enforce the
 * same check server-side and remain authoritative. The password is never
 * logged or echoed back.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return fail(403, "forbidden", "Cross-origin request blocked.")
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  const password = (body as Record<string, unknown> | null)?.password
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return fail(400, "invalid_request", "A password string is required.")
  }

  const result = checkPasswordBreach(password)
  return ok({
    breached: result.breached,
    reasons: result.reasons,
    severity: result.severity,
  })
}
