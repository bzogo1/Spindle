import { getAuthBackend } from "@/lib/auth/backend"
import { listAuthEvents, type AuthAuditEvent } from "@/lib/auth/audit"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import { isLoginHistoryEventType } from "@/lib/auth/login-history"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/login-history?type=&from=&to=&limit=&offset= — the signed-in
 * user's own auth audit events (sign-ins, failures, 2FA changes, session
 * revocations, …), newest first.
 *
 * Scoping: events are always filtered by the caller's `uid` from the verified
 * access token — there is no way to read another user's history. The audit
 * store is global and may contain anonymous events (`userId: null`); those
 * are never returned here.
 *
 * The audit store's `list()` supports user/type filters and a hard limit but
 * no date range or offset, so this route scans the newest
 * {@link AUDIT_SCAN_LIMIT} matching events and applies `from`/`to`/`offset`
 * itself. `total`/`hasMore` therefore describe that scanned window — with the
 * bounded in-memory store (capacity 1000) this is exact in practice; a
 * durable backend should push the filters down.
 *
 * Rate limit: `publicRead` preset (60 req/min per IP) like other read-only
 * auth endpoints.
 */

const limiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_OFFSET = 10_000
/** Matches `MAX_LIST_LIMIT` inside the audit store — the most it will return. */
const AUDIT_SCAN_LIMIT = 200

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** Strict unsigned-integer params — `parseInt` would silently accept "50abc". */
const UNSIGNED_INTEGER = /^\d+$/

function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT
  if (!UNSIGNED_INTEGER.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) return null
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function parseOffset(raw: string | null): number | null {
  if (raw === null) return 0
  if (!UNSIGNED_INTEGER.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) return null
  return Math.min(parsed, MAX_OFFSET)
}

/**
 * Parses a `from`/`to` query param into epoch ms (inclusive bounds).
 * Date-only values (`YYYY-MM-DD`) are interpreted in UTC: `from` as the start
 * of that day, `to` as the end of that day. Returns `null` when absent and
 * `"invalid"` for unparseable input.
 */
function parseDateParam(raw: string | null, endOfDay: boolean): number | null | "invalid" {
  if (raw === null || raw === "") return null
  const value = DATE_ONLY.test(raw) ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : raw
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? "invalid" : ms
}

function inRange(event: AuthAuditEvent, fromMs: number | null, toMs: number | null): boolean {
  const at = Date.parse(event.timestamp)
  if (Number.isNaN(at)) return false
  if (fromMs !== null && at < fromMs) return false
  if (toMs !== null && at > toMs) return false
  return true
}

export async function GET(request: Request) {
  if (!limiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  const params = new URL(request.url).searchParams

  const limit = parseLimit(params.get("limit"))
  const offset = parseOffset(params.get("offset"))
  if (limit === null || offset === null) {
    return fail(400, "invalid_request", "Invalid limit or offset.")
  }

  const rawType = params.get("type")
  if (rawType !== null && !isLoginHistoryEventType(rawType)) {
    return fail(400, "invalid_request", "Unknown event type.")
  }

  const fromMs = parseDateParam(params.get("from"), false)
  const toMs = parseDateParam(params.get("to"), true)
  if (fromMs === "invalid" || toMs === "invalid") {
    return fail(400, "invalid_request", "Invalid date range.")
  }
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    return fail(400, "invalid_request", "The start date is after the end date.")
  }

  // The store filters by userId/type while walking newest-first; date range
  // and offset are applied on top of that bounded scan.
  const scanned = listAuthEvents({
    userId: access.uid,
    ...(rawType ? { type: rawType } : {}),
    limit: AUDIT_SCAN_LIMIT,
  })

  const inWindow = scanned.filter((event) => inRange(event, fromMs, toMs))
  const events = inWindow.slice(offset, offset + limit)

  return ok({
    events,
    limit,
    offset,
    total: inWindow.length,
    hasMore: offset + events.length < inWindow.length,
  })
}
