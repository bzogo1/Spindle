import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/admin-guard"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok, readCookie } from "@/lib/auth/http"
import { decodeMockSession, MOCK_SESSION_COOKIE, mockAuthEnabled } from "@/lib/auth/mock-session"
import { getLastSeenDate, getUnseenEntries, notifyNewEntries } from "@/lib/changelog-notify"
import { createRateLimiter } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET  /api/changelog/notify — the caller's unseen changelog entries plus
 *   `unseenCount`/`lastSeen`, backing the `/app/whats-new` page.
 * POST /api/changelog/notify — admin-triggered "publish notifications":
 *   broadcasts an in-app message for every changelog entry not yet
 *   notified, then reports `{ sent, skipped }`. Idempotent — entries are
 *   only broadcast once (see `src/lib/changelog-notify.ts`).
 *
 * Session resolution mirrors `/api/messages`: the `spindle_at` access
 * cookie hydrated via `getAuthBackend().getUserById`, or the mock-session
 * cookie keyed `mock:<email>` when mock auth is enabled. POST is admin-only
 * via `requireAdmin` (401 unauthenticated / 403 non-admin).
 */

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
/** Publishing is rare and admin-initiated; 30/hour per IP is generous. */
const writeLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

async function resolvePrincipal(request: Request): Promise<string | null> {
  const access = accessTokenFromRequest(request)
  if (access) {
    const user = await getAuthBackend().getUserById(access.uid)
    return user ? user.id : null
  }

  if (mockAuthEnabled) {
    const session = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    if (session) {
      return `mock:${session.user.email.trim().toLowerCase()}`
    }
  }

  return null
}

export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const principal = await resolvePrincipal(request)
  if (!principal) {
    return fail(401, "unauthenticated", "Sign in to view changelog updates.")
  }

  const unseen = getUnseenEntries(principal)
  return ok({
    unseen,
    unseenCount: unseen.length,
    lastSeen: getLastSeenDate(principal),
  })
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const admin = await requireAdmin(request)
  if (admin instanceof NextResponse) return admin

  const result = notifyNewEntries()
  return ok({
    sent: result.sent,
    skipped: result.skipped,
    entries: result.entries,
  })
}
