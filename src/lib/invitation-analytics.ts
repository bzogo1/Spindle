import type { InvitationRecord } from "@/lib/invitations"
import type { WorkspaceRole } from "@/lib/members/permissions"

/**
 * Invitation analytics aggregation (task 27).
 *
 * Pure functions over `InvitationRecord[]` — the route scopes the records to
 * the caller (`invitationStore.listForInviter`) and this module derives the
 * metrics. Type-only imports keep the module free of the store's server-only
 * dependencies (`env.server`), so it stays safe to unit-test in any
 * environment.
 *
 * Field availability vs. the ideal metric set:
 *
 *  - `createdAt` / `lastSentAt` / `expiresAt` / `acceptedAt` / `status` /
 *    `role` / `email` all exist on the record, so status totals, acceptance
 *    rate, time-to-accept, send windows, role mix, and email domains are all
 *    computable.
 *  - Time-to-accept is measured `acceptedAt - lastSentAt`: resends rotate the
 *    accept link (`sts` claim), so the last send is when the currently-valid
 *    link went out. `createdAt`-based timing would over-count invites that
 *    were resent before being accepted.
 *  - "Invites sent per period" counts records by `createdAt`. The store keeps
 *    only the LATEST `lastSentAt`, so individual resends cannot be counted —
 *    a resend-heavy invite contributes once. Documented gap: per-send history
 *    would need a store change (owned by the invitations workstream).
 *  - There is no "opened"/"clicked" tracking — acceptance is the only
 *    downstream signal, so funnel metrics stop at sent → accepted/revoked/
 *    expired.
 */

export const ANALYTICS_WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000
export const ANALYTICS_WINDOW_30D_MS = 30 * 24 * 60 * 60 * 1000

/** Max rows in the `topDomains` breakdown. */
export const TOP_DOMAINS_LIMIT = 5

export type InvitationStatusCounts = {
  pending: number
  accepted: number
  revoked: number
  /** Pending records whose `expiresAt` has passed — derived, not stored. */
  expired: number
}

export type InvitationTimeToAccept = {
  /** Mean `acceptedAt - lastSentAt` across accepted invites, in ms. */
  averageMs: number | null
  /** Median of the same deltas, in ms. */
  medianMs: number | null
  /** Number of accepted invites that contributed a usable delta. */
  sampleSize: number
}

export type InvitationAnalytics = {
  /** ISO timestamp the aggregation was computed at. */
  generatedAt: string
  total: number
  byStatus: InvitationStatusCounts
  /**
   * `accepted / total`, in `[0, 1]`; `null` when there are no invitations at
   * all (0/0 is undefined, not 0%).
   */
  acceptanceRate: number | null
  timeToAccept: InvitationTimeToAccept
  /** Invitations CREATED within the trailing windows (see module docs). */
  sent: {
    last7Days: number
    last30Days: number
  }
  /** Invite count per grantable role. */
  roles: Record<WorkspaceRole, number>
  /** Most-invited email domains, descending by count. */
  topDomains: { domain: string; count: number }[]
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/** Derived client-facing status — mirrors `invitationViewStatus` in the store. */
function viewStatus(record: InvitationRecord, now: number): keyof InvitationStatusCounts {
  if (record.status !== "pending") return record.status
  const expiresAt = parseTime(record.expiresAt)
  return expiresAt !== null && expiresAt <= now ? "expired" : "pending"
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at < 0 || at === email.length - 1) return null
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return domain.length > 0 ? domain : null
}

/**
 * Aggregates invitation records into the analytics payload returned by
 * `GET /api/invitations/analytics`. `now` is injectable for deterministic
 * tests (defaults to `Date.now()`).
 */
export function computeInvitationAnalytics(
  records: readonly InvitationRecord[],
  now: number = Date.now(),
): InvitationAnalytics {
  const byStatus: InvitationStatusCounts = {
    pending: 0,
    accepted: 0,
    revoked: 0,
    expired: 0,
  }
  const roles: Record<WorkspaceRole, number> = { owner: 0, admin: 0, member: 0 }
  const domains = new Map<string, number>()
  const acceptDeltas: number[] = []
  let sentLast7Days = 0
  let sentLast30Days = 0

  for (const record of records) {
    byStatus[viewStatus(record, now)] += 1
    // Guard against out-of-enum roles slipping in from a future store so one
    // bad row can't poison the whole breakdown with NaN.
    if (record.role === "owner" || record.role === "admin" || record.role === "member") {
      roles[record.role] += 1
    }

    const domain = emailDomain(record.email)
    if (domain) domains.set(domain, (domains.get(domain) ?? 0) + 1)

    const createdAt = parseTime(record.createdAt)
    if (createdAt !== null) {
      if (now - createdAt <= ANALYTICS_WINDOW_7D_MS) sentLast7Days += 1
      if (now - createdAt <= ANALYTICS_WINDOW_30D_MS) sentLast30Days += 1
    }

    if (record.status === "accepted" && record.acceptedAt) {
      const sentAt = parseTime(record.lastSentAt)
      const acceptedAt = parseTime(record.acceptedAt)
      // Negative deltas mean clock skew or a hand-edited record — skip them
      // rather than let one bad row poison the averages.
      if (sentAt !== null && acceptedAt !== null && acceptedAt >= sentAt) {
        acceptDeltas.push(acceptedAt - sentAt)
      }
    }
  }

  const total = records.length
  const averageMs =
    acceptDeltas.length > 0
      ? Math.round(acceptDeltas.reduce((sum, delta) => sum + delta, 0) / acceptDeltas.length)
      : null

  return {
    generatedAt: new Date(now).toISOString(),
    total,
    byStatus,
    acceptanceRate: total > 0 ? byStatus.accepted / total : null,
    timeToAccept: {
      averageMs,
      medianMs: median(acceptDeltas),
      sampleSize: acceptDeltas.length,
    },
    sent: { last7Days: sentLast7Days, last30Days: sentLast30Days },
    roles,
    topDomains: [...domains.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
      .slice(0, TOP_DOMAINS_LIMIT),
  }
}
