import { changelogReleases, getReleasePath, type ChangelogRelease } from "@/lib/changelog"
import { sendMessage } from "@/lib/in-app-messages"

/**
 * Changelog notification seam — tells app users when new changelog entries
 * ship.
 *
 * Two pieces of per-process state, both DEVELOPMENT SEAMS (same interim-store
 * pattern as `in-app-messages.ts` / `newsletter-store.ts`):
 *
 *  - `lastSeen` — per-principal release date (`YYYY-MM-DD`) the user has
 *    acknowledged on `/app/whats-new`. Keyed by the same principal strings
 *    the messages routes use (auth user id, or `mock:<email>`). Comparing
 *    ISO dates lexicographically is safe.
 *  - `notifiedIds` — release slugs already broadcast to every inbox via
 *    `sendMessage`, so `notifyNewEntries` never double-notifies an entry.
 *    Broadcasts are global by nature; per-user "seen" state only affects
 *    the What's New page, not delivery.
 *
 * Upgrade path: a `ChangelogSeen` table (`userId`, `lastSeenDate`) plus a
 * `notifiedAt` column on the release record. Signatures are already shaped
 * for that swap.
 */

/** Trims an entry summary to a single-line inbox-friendly excerpt. */
const EXCERPT_MAX_LENGTH = 280

export interface ChangelogEntry {
  /** Stable id — the release slug. */
  id: string
  slug: string
  version: string
  /** Publication date, YYYY-MM-DD. */
  date: string
  title: string
  summary: string
  /** In-app path of the dedicated release page. */
  url: string
}

export interface NotifyResult {
  /** Entries broadcast during this call. */
  sent: number
  /** Entries skipped because they were already broadcast. */
  skipped: number
  entries: { id: string; title: string }[]
}

const lastSeen = new Map<string, string>() // principal -> YYYY-MM-DD
const notifiedIds = new Set<string>() // release slug

function toEntry(release: ChangelogRelease): ChangelogEntry {
  return {
    id: release.slug,
    slug: release.slug,
    version: release.version,
    date: release.date,
    title: release.title,
    summary: release.summary,
    url: getReleasePath(release),
  }
}

/** All changelog entries, newest first. */
export function getChangelogEntries(): ChangelogEntry[] {
  return [...changelogReleases].sort((a, b) => b.date.localeCompare(a.date)).map(toEntry)
}

/**
 * Finds an entry among releases already published by `now`. Future-dated
 * entries are not markable — letting a user acknowledge one would push
 * `lastSeen` past today and suppress every real unseen entry.
 */
function findPublishedEntry(id: string, now: Date): ChangelogEntry | undefined {
  return publishedEntries(now).find((entry) => entry.id === id)
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Entries published on or before `now`'s date, newest first. */
function publishedEntries(now: Date): ChangelogEntry[] {
  const today = isoDate(now)
  return getChangelogEntries().filter((entry) => entry.date <= today)
}

/**
 * Entries newer than the user's last-seen release date. Users who never
 * opened What's New see every published entry. Future-dated entries are
 * excluded. `now` defaults to the current time.
 */
export function getUnseenEntries(userId: string, now: Date = new Date()): ChangelogEntry[] {
  const seenDate = lastSeen.get(userId)
  return publishedEntries(now).filter((entry) => seenDate === undefined || entry.date > seenDate)
}

/** The user's acknowledged release date, or null when never marked. */
export function getLastSeenDate(userId: string): string | null {
  return lastSeen.get(userId) ?? null
}

/**
 * Marks changelog entries seen for `userId` by advancing their last-seen
 * date — seen state only moves forward, never backward.
 *
 *  - `{ entryId }` marks everything up to and including that entry.
 *  - No `entryId` (or null) marks everything published so far.
 *
 * Returns `{ marked: false }` when an explicit `entryId` does not match a
 * release already published by `now` (unknown or future-dated ids cannot
 * advance `lastSeen`); otherwise `{ marked: true, lastSeen }`.
 */
export function markChangelogSeen(
  userId: string,
  entryId?: string | null,
  now: Date = new Date(),
): { marked: boolean; lastSeen: string | null } {
  let targetDate: string
  if (entryId) {
    const entry = findPublishedEntry(entryId, now)
    if (!entry) return { marked: false, lastSeen: lastSeen.get(userId) ?? null }
    targetDate = entry.date
  } else {
    const newest = publishedEntries(now)[0]
    if (!newest) return { marked: true, lastSeen: lastSeen.get(userId) ?? null }
    targetDate = newest.date
  }

  const current = lastSeen.get(userId)
  const next = current !== undefined && current > targetDate ? current : targetDate
  lastSeen.set(userId, next)
  return { marked: true, lastSeen: next }
}

function excerpt(summary: string): string {
  const flat = summary.replace(/\s+/g, " ").trim()
  return flat.length > EXCERPT_MAX_LENGTH ? `${flat.slice(0, EXCERPT_MAX_LENGTH - 1)}…` : flat
}

/**
 * Broadcasts an in-app message for every published entry that has not been
 * notified yet (oldest first, so inbox ordering reads chronologically).
 * Idempotent: already-notified slugs are skipped, so repeated admin triggers
 * or lazy calls never duplicate notifications. Returns per-call counts.
 */
export function notifyNewEntries(now: Date = new Date()): NotifyResult {
  const published = publishedEntries(now)
  const pending = [...published].reverse().filter((entry) => !notifiedIds.has(entry.id))

  const entries: { id: string; title: string }[] = []
  for (const entry of pending) {
    sendMessage({
      userId: null,
      subject: `Update: ${entry.title}`,
      body: excerpt(entry.summary),
      kind: "info",
    })
    notifiedIds.add(entry.id)
    entries.push({ id: entry.id, title: entry.title })
  }

  return { sent: entries.length, skipped: published.length - entries.length, entries }
}

/** Test hook: clears per-user seen state and the notified-id set. */
export function clearChangelogNotifyState(): void {
  lastSeen.clear()
  notifiedIds.clear()
}
