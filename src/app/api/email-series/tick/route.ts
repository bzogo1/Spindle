import { timingSafeEqual } from "node:crypto"

import { fail } from "@/lib/auth/http"
import { getServerEnv } from "@/lib/env.server"
import { processEmailSeriesQueue } from "@/lib/email-series"
import { clientIp, createRateLimiter } from "@/lib/site-forms"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Best-effort per-instance limit; see createRateLimiter for caveats.
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

function bearerMatches(token: string, secret: string): boolean {
  const left = Buffer.from(token)
  const right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * POST /api/email-series/tick — dispatch due drip-series emails.
 *
 * This is the cron entry point for `processEmailSeriesQueue()`. Auth:
 *  - `SESSION_SECRET` set → requires `Authorization: Bearer <secret>`.
 *    Point the scheduler at this route with the same secret.
 *  - `SESSION_SECRET` unset → allowed only outside production (local dev /
 *    tests); in production the route fails closed with 503.
 *
 * Alternatively, a scheduler can call `processEmailSeriesQueue()` directly
 * in-process; this route just exposes it over HTTP.
 */
export async function POST(request: Request) {
  if (!limiter.check(clientIp(request))) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.")
  }

  const env = getServerEnv()
  const secret = env.SESSION_SECRET
  if (!secret) {
    if (env.NODE_ENV === "production") {
      return fail(
        503,
        "unconfigured",
        "SESSION_SECRET is required to authorize ticks in production.",
      )
    }
  } else {
    const header = request.headers.get("authorization") ?? ""
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
    if (!token || !bearerMatches(token, secret)) {
      return fail(401, "unauthorized", "A valid bearer token is required.")
    }
  }

  try {
    const summary = await processEmailSeriesQueue()
    logger.info({ event: "email.series.tick", ...summary }, "Email series queue tick completed")
    return Response.json({ ok: true, ...summary })
  } catch (error) {
    logger.error({ event: "email.series.tick_failed", err: error }, "Email series tick failed")
    return fail(500, "tick_failed", "The email series tick failed.")
  }
}
