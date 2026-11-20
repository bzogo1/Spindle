/**
 * Notification threading.
 *
 * Groups feed items that share a category and a normalized subject within a
 * sliding time window into `NotificationThread`s, newest first. The window
 * compares each item against the thread's *latest* item, so a burst of
 * related updates chains into one thread while a later, separated burst
 * starts a new one.
 *
 * Generic over a minimal structural type so it works with `AppNotification`
 * without this lib module importing from the component layer.
 */

export interface ThreadableNotification {
  id: string
  title: string
  createdAt: string
  read: boolean
  /** Optional category tag — part of the thread key. */
  category?: string
  /** Optional explicit subject; falls back to the normalized title. */
  subject?: string
}

export interface NotificationThread<T extends ThreadableNotification = ThreadableNotification> {
  /** Stable key: `category::subject` (category falls back to "other"). */
  key: string
  /** Human-readable subject (the latest item's title is preferred by callers). */
  subject: string
  category?: string
  /** Thread members, newest first. */
  items: T[]
  /** createdAt of the newest member (ISO). */
  latestAt: string
  unreadCount: number
}

/** Default burst window: updates within 6h of the thread's latest item join it. */
export const NOTIFICATION_THREAD_WINDOW_MS = 6 * 60 * 60 * 1000

function timestampOf(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Normalize a notification into its thread subject: explicit `subject` when
 * present, otherwise the title — trimmed, lowercased, whitespace-collapsed,
 * and stripped of trailing sentence punctuation so "Run finished." and
 * "run finished" land in the same thread.
 */
export function notificationThreadSubject(notification: ThreadableNotification): string {
  const raw = notification.subject ?? notification.title
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?…\s]+$/u, "")
}

export function notificationThreadKey(notification: ThreadableNotification): string {
  return `${notification.category ?? "other"}::${notificationThreadSubject(notification)}`
}

/**
 * Bucket notifications into threads. Input order does not matter — items are
 * sorted newest-first internally. Threads are returned newest-first by their
 * latest member. Pass `windowMs` to tune the burst window and `now` for
 * deterministic tests.
 */
export function groupNotificationsIntoThreads<T extends ThreadableNotification>(
  notifications: readonly T[],
  options?: { windowMs?: number; now?: number },
): NotificationThread<T>[] {
  const windowMs = options?.windowMs ?? NOTIFICATION_THREAD_WINDOW_MS
  const sorted = [...notifications].sort(
    (a, b) => timestampOf(b.createdAt) - timestampOf(a.createdAt),
  )

  // A subject key can own several bursts — a Map of lists lets a later,
  // separated burst start a new thread instead of overwriting the old one.
  const byKey = new Map<string, NotificationThread<T>[]>()

  for (const notification of sorted) {
    const key = notificationThreadKey(notification)
    const itemTime = timestampOf(notification.createdAt)
    const candidates = byKey.get(key) ?? []
    // Join the qualifying burst with the newest latestAt — an item can land
    // between two bursts and belongs to the fresher one.
    let existing: NotificationThread<T> | undefined
    for (const candidate of candidates) {
      const gap = timestampOf(candidate.latestAt) - itemTime
      if (
        gap <= windowMs &&
        (!existing || timestampOf(candidate.latestAt) > timestampOf(existing.latestAt))
      ) {
        existing = candidate
      }
    }

    if (existing && timestampOf(existing.latestAt) - itemTime <= windowMs) {
      existing.items.push(notification)
      if (!notification.read) existing.unreadCount += 1
      continue
    }

    const thread: NotificationThread<T> = {
      key,
      subject: notificationThreadSubject(notification),
      category: notification.category,
      items: [notification],
      latestAt: notification.createdAt,
      unreadCount: notification.read ? 0 : 1,
    }
    byKey.set(key, [thread, ...candidates])
  }

  const threads = [...byKey.values()].flat()
  return threads.sort((a, b) => timestampOf(b.latestAt) - timestampOf(a.latestAt))
}
