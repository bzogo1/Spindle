/**
 * Feature announcements: admin-published messages shown to app users as a
 * dismissible banner (`AnnouncementBanner`, mounted by the `(app)` layout).
 *
 * DEVELOPMENT SEAM: state lives in process-local `Map`s, same interim-store
 * pattern as `newsletter-store.ts`. On serverless or multi-instance deploys
 * each instance keeps its own copy — an announcement created on one instance
 * is invisible to the others, and everything (including per-user dismissals)
 * is lost on restart. The upgrade path is an `Announcement` table plus a
 * per-user dismissal table; the exported function signatures are already
 * shaped for that swap.
 *
 * There is no draft state: `createAnnouncement` publishes immediately
 * (`publishedAt` = creation time) and `startsAt` schedules when it becomes
 * visible. `listAllAnnouncements` therefore returns every stored record —
 * live, scheduled, and expired alike — newest first.
 *
 * Server-only in practice: imported by route handlers and API tests; client
 * components must not import it.
 */

export type AnnouncementAudience = "all" | "admins"

export const ANNOUNCEMENT_AUDIENCES: readonly AnnouncementAudience[] = ["all", "admins"]

export interface Announcement {
  id: string
  title: string
  body: string
  ctaLabel?: string
  ctaHref?: string
  audience: AnnouncementAudience
  /** ISO timestamp — the announcement is hidden before this instant. */
  startsAt: string
  /** ISO timestamp — optional end of the visibility window. */
  endsAt?: string
  /** ISO timestamp — when the admin published it (always set on create). */
  publishedAt: string
  /** ISO timestamp — record creation time. */
  createdAt: string
}

export interface CreateAnnouncementInput {
  title: string
  body: string
  ctaLabel?: string
  ctaHref?: string
  audience?: AnnouncementAudience
  /** ISO timestamp or any `Date.parse`-able string. */
  startsAt: string
  /** ISO timestamp or any `Date.parse`-able string; must be after `startsAt`. */
  endsAt?: string
}

/** Hard caps so the in-memory store cannot grow without bound. */
export const ANNOUNCEMENTS_STORE_MAX = 500
const DISMISSAL_USERS_MAX = 10_000
const DISMISSALS_PER_USER_MAX = 500

const announcements = new Map<string, Announcement>() // id → record
/** userId → set of dismissed announcement ids (insertion-ordered). */
const dismissals = new Map<string, Set<string>>()

function announcementId(): string {
  return `ann_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function toIso(value: string, field: string): string {
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    throw new Error(`${field} must be a valid date/time.`)
  }
  return new Date(time).toISOString()
}

/**
 * Publishes an announcement. `publishedAt`/`createdAt` are set to now;
 * `startsAt` may be in the future to schedule it. Throws when `endsAt` is
 * not strictly after `startsAt` or when a date is unparseable — callers
 * (the admin route) validate first via zod and map this to a 400.
 */
export function createAnnouncement(input: CreateAnnouncementInput): Announcement {
  const startsAt = toIso(input.startsAt, "startsAt")
  const endsAt = input.endsAt !== undefined ? toIso(input.endsAt, "endsAt") : undefined
  if (endsAt !== undefined && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error("endsAt must be after startsAt.")
  }

  const trimmedLabel = input.ctaLabel?.trim()
  const trimmedHref = input.ctaHref?.trim()
  const now = nowIso()
  const announcement: Announcement = {
    id: announcementId(),
    title: input.title.trim(),
    body: input.body.trim(),
    ...(trimmedLabel ? { ctaLabel: trimmedLabel } : {}),
    ...(trimmedHref ? { ctaHref: trimmedHref } : {}),
    audience: input.audience ?? "all",
    startsAt,
    ...(endsAt !== undefined ? { endsAt } : {}),
    publishedAt: now,
    createdAt: now,
  }

  // Bounded capacity: evict the oldest record (Map preserves insertion
  // order) so a flood of announcements cannot grow memory without limit.
  if (announcements.size >= ANNOUNCEMENTS_STORE_MAX) {
    const oldest = announcements.keys().next().value
    if (oldest !== undefined) announcements.delete(oldest)
  }
  announcements.set(announcement.id, announcement)
  return announcement
}

function dismissedIds(userId: string): Set<string> | undefined {
  return dismissals.get(userId)
}

/**
 * Announcements visible to `userId` at `now` (defaults to the current time):
 * published (`publishedAt <= now`), inside the `[startsAt, endsAt]` window,
 * audience-matched (`"all"` for everyone, `"admins"` only when `isAdmin`),
 * and not dismissed by this user. Newest `publishedAt` first.
 */
export function listActiveAnnouncements(
  userId: string,
  isAdmin: boolean,
  now: Date = new Date(),
): Announcement[] {
  const dismissed = dismissedIds(userId)
  const nowMs = now.getTime()

  return [...announcements.values()]
    .filter((announcement) => {
      if (announcement.audience === "admins" && !isAdmin) return false
      if (Date.parse(announcement.publishedAt) > nowMs) return false
      if (Date.parse(announcement.startsAt) > nowMs) return false
      if (announcement.endsAt !== undefined && Date.parse(announcement.endsAt) <= nowMs) {
        return false
      }
      if (dismissed?.has(announcement.id)) return false
      return true
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id))
}

/**
 * Records that `userId` dismissed `announcementId`. Idempotent — dismissing
 * the same announcement twice (or one that does not exist) is a no-op that
 * still succeeds, so retried POSTs are safe.
 */
export function dismissAnnouncement(userId: string, announcementIdValue: string): void {
  let set = dismissals.get(userId)
  if (!set) {
    // Bounded capacity: evict the least-recently-created dismissal set.
    if (dismissals.size >= DISMISSAL_USERS_MAX) {
      const oldest = dismissals.keys().next().value
      if (oldest !== undefined) dismissals.delete(oldest)
    }
    set = new Set()
    dismissals.set(userId, set)
  }
  // Re-insert so the user's set counts as recently used for user eviction.
  dismissals.delete(userId)
  dismissals.set(userId, set)

  if (set.has(announcementIdValue)) return
  // Per-user bound: drop the oldest dismissal (Set preserves insertion order).
  if (set.size >= DISMISSALS_PER_USER_MAX) {
    const oldest = set.values().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
  set.add(announcementIdValue)
}

/**
 * Admin listing: every stored announcement, newest `createdAt` first —
 * live, scheduled (future `startsAt`), and expired records alike.
 */
export function listAllAnnouncements(): Announcement[] {
  return [...announcements.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )
}

/** Test hook: clears all announcements and dismissal records. */
export function clearAnnouncementsForTests(): void {
  announcements.clear()
  dismissals.clear()
}
