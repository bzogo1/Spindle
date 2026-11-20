import {
  APP_NOTIFICATION_CATEGORIES,
  type AppNotification,
  type AppNotificationCategory,
} from "./notifications-provider"

/**
 * Group key for notifications that arrived without a `category` tag. Kept
 * separate from `AppNotificationCategory` so producers cannot opt into it —
 * it is a display fallback only.
 */
export type NotificationGroupKey = AppNotificationCategory | "other"

export interface NotificationGroup {
  key: NotificationGroupKey
  label: string
  items: AppNotification[]
}

/** Short headers for the grouped feed — distinct from the longer preference labels. */
const GROUP_LABELS: Record<NotificationGroupKey, string> = {
  activity: "Activity",
  agent: "Agent",
  automation: "Automations",
  lab: "Lab",
  mentions: "Mentions",
  product: "Product",
  security: "Security",
  other: "Other",
}

/** Display order: tagged categories first (in preference order), untagged last. */
const GROUP_ORDER: readonly NotificationGroupKey[] = [...APP_NOTIFICATION_CATEGORIES, "other"]

/**
 * Bucket notifications into category groups, preserving feed order inside each
 * group. Groups are emitted in `GROUP_ORDER`; categories with no items are
 * skipped. Untagged notifications land in the trailing "Other" group.
 */
export function groupNotificationsByCategory(
  notifications: readonly AppNotification[],
): NotificationGroup[] {
  const buckets = new Map<NotificationGroupKey, AppNotification[]>()
  for (const notification of notifications) {
    const key: NotificationGroupKey = notification.category ?? "other"
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(notification)
    } else {
      buckets.set(key, [notification])
    }
  }
  return GROUP_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    items: buckets.get(key) ?? [],
  }))
}
