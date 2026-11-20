import { renderNotificationDigestEmail } from "@/emails"
import { sendEmail, type EmailDelivery } from "@/lib/email"

/**
 * Notification email digest.
 *
 * The notification feed and its preferences currently live client-side
 * (localStorage + the in-memory realtime hub — see
 * `src/components/app/notifications-provider.tsx`), so this module is the
 * server-side half: it takes a caller-supplied feed + preferences snapshot,
 * applies the same delivery rules the settings UI exposes, renders the digest
 * template, and hands it to `sendEmail` (Resend when `RESEND_API_KEY` is set,
 * otherwise `"unconfigured"` — callers must treat that as a normal outcome).
 *
 * Cadence: `isDigestDue` is the pure eligibility check a scheduler (or the
 * `/api/notifications/digest` route) uses against the user's last-sent
 * timestamp. There is no server-side notifications store yet, so nothing
 * persists `lastSentAt` — wiring real daily/weekly scheduling is a follow-up
 * once the notifications data layer lands.
 */

export const DIGEST_NOTIFICATION_CATEGORIES = [
  "activity",
  "agent",
  "automation",
  "lab",
  "mentions",
  "product",
  "security",
] as const
export type DigestNotificationCategory = (typeof DIGEST_NOTIFICATION_CATEGORIES)[number]

/** Categories included in a digest when the caller supplies no preferences. */
const DEFAULT_CATEGORY_EMAIL: Record<DigestNotificationCategory, boolean> = {
  activity: false,
  agent: true,
  automation: false,
  lab: false,
  mentions: true,
  product: false,
  // Mirrors the provider defaults: security alerts default to email-on.
  security: true,
}

/** Mirrors `AppNotificationDigestFrequency` from the provider. */
export const DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number]

/** Minimum wall-clock gap between digests for each cadence. */
export const DIGEST_INTERVAL_MS: Record<Exclude<DigestFrequency, "off">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

/** Hard cap on items rendered into one digest email. */
export const DIGEST_MAX_ITEMS = 20

export interface DigestNotification {
  title: string
  body?: string
  href?: string
  /** Matches `AppNotificationCategory`; unknown/untagged pass the master switch only. */
  category?: string
  /** ISO timestamp used to order the digest newest-first. */
  createdAt?: string
}

export interface DigestPreferences {
  /** Master email switch — digest is never sent while false. */
  email: boolean
  categories: Record<DigestNotificationCategory, { email: boolean }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Normalize an untrusted preferences payload (route body, future stored
 * record) against safe defaults. The email master switch defaults to `false`
 * so a missing/malformed payload can never trigger unsolicited email.
 */
export function sanitizeDigestPreferences(value: unknown): DigestPreferences {
  const preferences: DigestPreferences = {
    email: false,
    categories: Object.fromEntries(
      DIGEST_NOTIFICATION_CATEGORIES.map((category) => [
        category,
        { email: DEFAULT_CATEGORY_EMAIL[category] },
      ]),
    ) as Record<DigestNotificationCategory, { email: boolean }>,
  }
  if (!isRecord(value)) return preferences

  if (typeof value.email === "boolean") preferences.email = value.email

  if (isRecord(value.categories)) {
    for (const category of DIGEST_NOTIFICATION_CATEGORIES) {
      const stored = value.categories[category]
      if (isRecord(stored) && typeof stored.email === "boolean") {
        preferences.categories[category] = { email: stored.email }
      }
    }
  }

  return preferences
}

/**
 * Whether a digest should go out now. `off` is never due; a missing
 * `lastSentAt` means the user has never received one and is due immediately.
 */
export function isDigestDue(input: {
  frequency: DigestFrequency
  lastSentAt?: string | number | Date | null
  now?: number
}): boolean {
  if (input.frequency === "off") return false
  if (input.lastSentAt === undefined || input.lastSentAt === null) return true

  const last =
    input.lastSentAt instanceof Date
      ? input.lastSentAt.getTime()
      : typeof input.lastSentAt === "number"
        ? input.lastSentAt
        : Date.parse(input.lastSentAt)
  if (Number.isNaN(last)) return true

  const now = input.now ?? Date.now()
  return now - last >= DIGEST_INTERVAL_MS[input.frequency]
}

function timestampOf(notification: DigestNotification): number {
  if (!notification.createdAt) return 0
  const parsed = Date.parse(notification.createdAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Apply the email channel rules to a raw feed:
 *  - master `email` switch off → nothing is eligible;
 *  - untagged notifications pass (same rule as the in-app feed);
 *  - a tagged notification passes only when its category's `email` toggle
 *    is on; categories outside the known set pass through untouched.
 *
 * Returns newest-first, capped at `DIGEST_MAX_ITEMS`; `overflowCount` reports
 * how many eligible items were dropped by the cap.
 */
export function selectDigestNotifications(
  notifications: readonly DigestNotification[],
  preferences: DigestPreferences,
): { items: DigestNotification[]; overflowCount: number } {
  if (!preferences.email) return { items: [], overflowCount: 0 }

  const eligible = notifications
    .filter((notification) => {
      const category = notification.category
      if (category === undefined) return true
      const known = DIGEST_NOTIFICATION_CATEGORIES.find((c) => c === category)
      if (!known) return true
      return preferences.categories[known].email
    })
    .slice()
    .sort((a, b) => timestampOf(b) - timestampOf(a))

  return {
    items: eligible.slice(0, DIGEST_MAX_ITEMS),
    overflowCount: Math.max(0, eligible.length - DIGEST_MAX_ITEMS),
  }
}

export type DigestDelivery = EmailDelivery | "empty" | "disabled"

export type DigestSendResult = {
  delivery: DigestDelivery
  /** Notifications that made it into the email after filtering/capping. */
  itemCount: number
  /** Eligible notifications omitted because of `DIGEST_MAX_ITEMS`. */
  overflowCount: number
}

/**
 * Filter, render, and send one user's digest. Returns `"disabled"` when the
 * email master switch is off and `"empty"` when nothing eligible remains —
 * both are normal outcomes, not errors. Throws only when the provider
 * rejects the send (same contract as `sendEmail`).
 */
export async function sendNotificationDigest(input: {
  to: string
  frequency: Exclude<DigestFrequency, "off">
  notifications: readonly DigestNotification[]
  preferences: unknown
  /** Absolute URL of the notifications page; defaults to the app route. */
  notificationsUrl?: string
}): Promise<DigestSendResult> {
  const preferences = sanitizeDigestPreferences(input.preferences)
  if (!preferences.email) return { delivery: "disabled", itemCount: 0, overflowCount: 0 }

  const { items, overflowCount } = selectDigestNotifications(input.notifications, preferences)
  if (items.length === 0) return { delivery: "empty", itemCount: 0, overflowCount: 0 }

  const email = renderNotificationDigestEmail({
    frequency: input.frequency,
    items,
    overflowCount,
    notificationsUrl: input.notificationsUrl,
  })

  const delivery = await sendEmail({
    to: input.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  })

  return { delivery, itemCount: items.length, overflowCount }
}
