import type { AuthAuditEvent, AuthAuditEventType } from "@/lib/auth/audit"
import { isLoginHistoryEventType, LOGIN_HISTORY_EVENT_TYPES } from "@/lib/auth/login-history"

/**
 * Shared constants and query parsing for the admin audit dashboard
 * (`/app/admin/audit` + `GET /api/admin/audit/*`).
 *
 * Kept in a leaf module so the client screen can import the outcome helpers
 * without pulling the audit store (or the admin API guard's server-only
 * imports) into the browser bundle — `audit.ts` is imported as types only.
 */

/** Every event type the auth audit log can record, in display order. */
export const ADMIN_AUDIT_EVENT_TYPES = LOGIN_HISTORY_EVENT_TYPES

export function isAdminAuditEventType(value: string): value is AuthAuditEventType {
  return isLoginHistoryEventType(value)
}

export type AdminAuditOutcome = "success" | "failure" | "info"

export const ADMIN_AUDIT_OUTCOMES = ["success", "failure", "info"] as const

const OUTCOME_BY_TYPE: Record<AuthAuditEventType, AdminAuditOutcome> = {
  "signin.success": "success",
  "signin.failure": "failure",
  "signin.totp_challenge": "info",
  logout: "info",
  "token.refresh": "info",
  "session.revoked": "info",
  "password.reset": "success",
  "email.verify": "success",
  "totp.enroll": "success",
  "totp.disable": "info",
}

export function auditOutcomeForType(type: AuthAuditEventType): AdminAuditOutcome {
  return OUTCOME_BY_TYPE[type] ?? "info"
}

export function isAdminAuditOutcome(value: string): value is AdminAuditOutcome {
  return (ADMIN_AUDIT_OUTCOMES as readonly string[]).includes(value)
}

export type AdminAuditFilters = {
  /** Exact user id match (store-side filter). */
  userId?: string
  /** Exact email match (store-side filter). */
  email?: string
  /**
   * Free-text user filter (post-filter): case-insensitive substring match
   * against the event's email and userId. Lets the UI offer a single "user"
   * search box without knowing whether the value is an email or an id.
   */
  user?: string
  type?: AuthAuditEventType
  /** Post-filter applied in the route (the store has no outcome concept). */
  outcome?: AdminAuditOutcome
  /** Inclusive epoch-ms bounds; null = unbounded. */
  fromMs: number | null
  toMs: number | null
}

export type ParsedAdminAuditQuery = {
  ok: true
  filters: AdminAuditFilters
  limit: number
  offset: number
}

export type AdminAuditQueryError = { ok: false; message: string }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_OFFSET = 10_000
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

function cleanParam(raw: string | null): string | undefined {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Parses the shared admin-audit query string used by both the events and
 * stats endpoints: `userId`, `email`, `type`, `outcome`, `from`, `to`,
 * `limit`, `offset`. The stats endpoint ignores `limit`/`offset`.
 */
export function parseAdminAuditQuery(
  params: URLSearchParams,
): ParsedAdminAuditQuery | AdminAuditQueryError {
  const limit = parseLimit(params.get("limit"))
  const offset = parseOffset(params.get("offset"))
  if (limit === null || offset === null) {
    return { ok: false, message: "Invalid limit or offset." }
  }

  const rawType = params.get("type")
  let type: AuthAuditEventType | undefined
  if (rawType) {
    if (!isAdminAuditEventType(rawType)) {
      return { ok: false, message: "Unknown event type." }
    }
    type = rawType
  }

  const rawOutcome = params.get("outcome")
  let outcome: AdminAuditOutcome | undefined
  if (rawOutcome) {
    if (!isAdminAuditOutcome(rawOutcome)) {
      return { ok: false, message: "Unknown outcome." }
    }
    outcome = rawOutcome
  }

  const fromMs = parseDateParam(params.get("from"), false)
  const toMs = parseDateParam(params.get("to"), true)
  if (fromMs === "invalid" || toMs === "invalid") {
    return { ok: false, message: "Invalid date range." }
  }
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    return { ok: false, message: "The start date is after the end date." }
  }

  return {
    ok: true,
    filters: {
      userId: cleanParam(params.get("userId")),
      email: cleanParam(params.get("email")),
      user: cleanParam(params.get("user")),
      ...(type ? { type } : {}),
      ...(outcome ? { outcome } : {}),
      fromMs,
      toMs,
    },
    limit,
    offset,
  }
}

/**
 * Post-store filters the audit log cannot express itself: the free-text
 * `user` search, outcome (derived from the event type), and the inclusive
 * timestamp window.
 */
export function adminAuditEventInWindow(
  event: Pick<AuthAuditEvent, "type" | "timestamp" | "email" | "userId">,
  filters: Pick<AdminAuditFilters, "user" | "outcome" | "fromMs" | "toMs">,
): boolean {
  if (filters.user) {
    const needle = filters.user.toLowerCase()
    const haystack = [event.email, event.userId]
      .filter((part): part is string => Boolean(part))
      .join("\n")
      .toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  if (filters.outcome && auditOutcomeForType(event.type) !== filters.outcome) {
    return false
  }
  const at = Date.parse(event.timestamp)
  if (Number.isNaN(at)) return false
  if (filters.fromMs !== null && at < filters.fromMs) return false
  if (filters.toMs !== null && at > filters.toMs) return false
  return true
}

export type AdminAuditTopUser = {
  /** Display label: email when present, else userId, else "anonymous". */
  label: string
  email: string | null
  userId: string | null
  count: number
}

export type AdminAuditStats = {
  /** Events in the filtered window. */
  total: number
  successCount: number
  failureCount: number
  /** failureCount / total; null when the window is empty. */
  failureRate: number | null
  /** Event count per type; every known type is present (0 when absent). */
  byType: Record<AuthAuditEventType, number>
  /** Event count per UTC day (YYYY-MM-DD), ascending by day. */
  byDay: { day: string; count: number }[]
  /** Most active users in the window, descending by count (max 10). */
  topUsers: AdminAuditTopUser[]
}

const TOP_USERS_LIMIT = 10

function userKey(event: AuthAuditEvent): string {
  return event.email ?? event.userId ?? ""
}

/**
 * Aggregates a set of audit events (already filtered by the caller) into the
 * dashboard stats payload. Pure and synchronous — the routes feed it the
 * bounded scan window from `listAuthEvents`.
 */
export function computeAdminAuditStats(events: AuthAuditEvent[]): AdminAuditStats {
  const byType = Object.fromEntries(ADMIN_AUDIT_EVENT_TYPES.map((type) => [type, 0])) as Record<
    AuthAuditEventType,
    number
  >
  const byDayMap = new Map<string, number>()
  const userMap = new Map<string, AdminAuditTopUser>()
  let successCount = 0
  let failureCount = 0

  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1
    const outcome = auditOutcomeForType(event.type)
    if (outcome === "success") successCount += 1
    else if (outcome === "failure") failureCount += 1

    const at = Date.parse(event.timestamp)
    if (!Number.isNaN(at)) {
      const day = new Date(at).toISOString().slice(0, 10)
      byDayMap.set(day, (byDayMap.get(day) ?? 0) + 1)
    }

    const key = userKey(event)
    const existing = userMap.get(key)
    if (existing) {
      existing.count += 1
    } else {
      userMap.set(key, {
        label: event.email ?? event.userId ?? "anonymous",
        email: event.email,
        userId: event.userId,
        count: 1,
      })
    }
  }

  const byDay = [...byDayMap.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const topUsers = [...userMap.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP_USERS_LIMIT)

  return {
    total: events.length,
    successCount,
    failureCount,
    failureRate: events.length === 0 ? null : failureCount / events.length,
    byType,
    byDay,
    topUsers,
  }
}
