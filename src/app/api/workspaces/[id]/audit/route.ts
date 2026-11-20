import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { fail, ok } from "@/lib/auth/http"
import { requireWorkspaceRole } from "@/lib/workspace-auth"
import { listWorkspaceEvents, type WorkspaceAuditEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)

const AUDIT_ROLES = ["owner", "admin"] as const

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_TYPE_LENGTH = 100
const UNSIGNED_INTEGER = /^\d+$/
/**
 * ISO-8601-ish date or datetime: `YYYY-MM-DD` optionally followed by a
 * `T`/space-separated time with optional seconds, fractional seconds, and a
 * `Z`/`±hh:mm` offset. Date-only values (what the `<input type="date">`
 * filter sends) are accepted; anything `Date.parse` accepts but this rejects
 * (e.g. `"Jan 1 2020"`, `"1/1/2020"`) is treated as malformed.
 */
const ISO_DATE_LIKE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Actor display info attached to each event. `null` when `actorId` is null
 * (system/unknown actor) or the user row no longer resolves.
 */
type WorkspaceAuditActor = {
  id: string
  name: string | null
  email: string
}

type EnrichedWorkspaceAuditEvent = WorkspaceAuditEvent & {
  actor: WorkspaceAuditActor | null
}

type Params = { params: Promise<{ id: string }> }

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
  return parsed
}

/**
 * Parses a `since`/`until` query param. Returns the raw value when it matches
 * {@link ISO_DATE_LIKE} and parses as a date, `null` when absent, and
 * `"invalid"` for malformed input.
 */
function parseDateParam(raw: string | null): string | null | "invalid" {
  if (raw === null || raw === "") return null
  if (!ISO_DATE_LIKE.test(raw)) return "invalid"
  return Number.isNaN(Date.parse(raw)) ? "invalid" : raw
}

/**
 * GET /api/workspaces/[id]/audit?type=&since=&until=&limit=&offset=
 *
 * Paginated workspace audit events, newest first. Owner/admin only —
 * `requireWorkspaceRole` resolves the session, confirms membership, and 403s
 * members without a privileged role.
 *
 * Filters (all optional):
 *  - `type` — case-insensitive substring match on the dotted event type,
 *  - `since` / `until` — ISO-8601 dates or datetimes, inclusive bounds
 *    (400 when malformed),
 *  - `limit` (default 50, clamped to 1–200) / `offset` (default 0).
 *
 * Auth runs before query-param validation so unauthenticated requests always
 * get 401 regardless of whether the params are well-formed.
 *
 * Each event is enriched with `actor` (`{id, name, email}`) resolved via
 * `backend.getUserById` for the unique actorIds on the page. The page is
 * capped at {@link MAX_LIMIT} events so the lookup count is bounded; the
 * in-memory audit store is a development seam anyway.
 */
export async function GET(request: Request, { params }: Params) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const { id } = await params

  // Authenticate/authorize first: malformed params from anonymous callers get
  // 401, matching sibling routes that check `requireWorkspaceRole`/`Context`
  // before touching the query string.
  const result = await requireWorkspaceRole(request, AUDIT_ROLES, id)
  if (!result.ok) return result.response

  const url = new URL(request.url)
  const type = url.searchParams.get("type")?.trim() ?? ""
  const since = parseDateParam(url.searchParams.get("since"))
  const until = parseDateParam(url.searchParams.get("until"))
  const limit = parseLimit(url.searchParams.get("limit"))
  const offset = parseOffset(url.searchParams.get("offset"))

  if (since === "invalid" || until === "invalid") {
    return fail(400, "invalid_request", "Invalid since/until date.")
  }
  if (limit === null || offset === null) {
    return fail(400, "invalid_request", "Invalid limit or offset.")
  }
  if (type.length > MAX_TYPE_LENGTH) {
    return fail(400, "invalid_request", "Type filter is too long.")
  }

  const { events, total } = listWorkspaceEvents(id, {
    ...(type ? { type } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    limit,
    offset,
  })

  // Resolve actor display info for the unique actorIds on this page.
  const actorIds = [
    ...new Set(events.map((event) => event.actorId).filter((v): v is string => v !== null)),
  ]
  const backend = getAuthBackend()
  const actors = await Promise.all(
    actorIds.map((actorId) => backend.getUserById(actorId).catch(() => null)),
  )
  const actorById = new Map<string, WorkspaceAuditActor>()
  actorIds.forEach((actorId, index) => {
    const user = actors[index]
    if (user) actorById.set(actorId, { id: user.id, name: user.name, email: user.email })
  })

  const enriched: EnrichedWorkspaceAuditEvent[] = events.map((event) => ({
    ...event,
    actor: event.actorId ? (actorById.get(event.actorId) ?? null) : null,
  }))

  return ok({ events: enriched, total, limit, offset })
}
