"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  NOTIFICATION_PUBLISH_PATH,
  NOTIFICATION_STREAM_PATH,
  isNotificationStreamEvent,
  type NotificationPayload,
  type NotificationStreamEvent,
} from "@/lib/notifications/events"
import {
  isNotificationAction,
  isSafeNotificationHref,
  sanitizeNotificationActions,
  trackNotificationAction,
  type NotificationAction,
} from "@/lib/notifications/actions"
import { showSystemNotification } from "@/lib/notifications/permission"
import {
  NOTIFICATION_SCHEDULES_STORAGE_KEY,
  advanceNotificationSchedule,
  buildNotificationSchedule,
  loadNotificationSchedules,
  saveNotificationSchedules,
  sanitizeNotificationSchedules,
  type NotificationSchedule,
  type NotificationScheduleInput,
} from "@/lib/notifications/schedules"
import {
  APP_NOTIFICATION_SOUND_TONES,
  playNotificationSound,
  type AppNotificationSoundPreferences,
  type AppNotificationSoundTone,
} from "./notification-sound"

export {
  APP_NOTIFICATION_SOUND_TONES,
  type AppNotificationSoundPreferences,
  type AppNotificationSoundTone,
}
export type { NotificationAction as AppNotificationAction }

export type AppNotificationType = "info" | "success" | "warning" | "error"

/**
 * Notification categories used by the preferences model. Producers may tag a
 * notification with one of these via `AppNotificationInput.category`; untagged
 * notifications are always delivered (subject to the master switches).
 */
export const APP_NOTIFICATION_CATEGORIES = [
  "activity",
  "agent",
  "automation",
  "lab",
  "mentions",
  "product",
  "security",
] as const
export type AppNotificationCategory = (typeof APP_NOTIFICATION_CATEGORIES)[number]

export const APP_NOTIFICATION_DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const
export type AppNotificationDigestFrequency = (typeof APP_NOTIFICATION_DIGEST_FREQUENCIES)[number]

/** Per-category delivery toggles for both channels. */
export interface AppNotificationCategoryPreferences {
  /** Deliver this category to the in-app feed. */
  inApp: boolean
  /** Send this category by email (stored locally until the email API lands). */
  email: boolean
}

/**
 * Per-project notification overrides, stored under
 * `AppNotificationPreferences.projects[projectId]`. A missing project entry —
 * or a missing category/channel inside it — means the global preference
 * applies unchanged, so overrides stay sparse.
 */
export interface AppNotificationProjectPreferences {
  /** Mute every in-app notification tagged with this project id. */
  muted: boolean
  /**
   * Per-category channel overrides for this project. Only the channels a
   * producer actually set are stored; unset channels inherit the global
   * category preference.
   */
  categories: Partial<Record<AppNotificationCategory, Partial<AppNotificationCategoryPreferences>>>
}

/**
 * User-level notification preferences. Persisted to localStorage by
 * `AppNotificationsProvider` so they survive reloads and sync across tabs via
 * the `storage` event. The shape is intentionally channel-agnostic per
 * category so project-level overrides can layer on top without reshaping
 * existing fields.
 */
export interface AppNotificationPreferences {
  /** Master switch for the in-app notification feed. */
  inApp: boolean
  /** Pause all in-app delivery while muted. */
  muted: boolean
  /** Email channel master switch — placeholder until the email API lands. */
  email: boolean
  /**
   * OS/browser notifications via the Notification API. Only takes effect
   * once the user grants permission; the in-app feed is unaffected.
   */
  system: boolean
  /** Per-category delivery toggles. */
  categories: Record<AppNotificationCategory, AppNotificationCategoryPreferences>
  /**
   * Per-project overrides keyed by project id. Edited from the project
   * settings screen; empty means every project inherits the globals.
   */
  projects: Record<string, AppNotificationProjectPreferences>
  /** Digest cadence for batched email summaries. */
  digestFrequency: AppNotificationDigestFrequency
  /** Sound played when a notification is delivered to the in-app feed. */
  sound: AppNotificationSoundPreferences
}

/** localStorage key for the persisted preferences blob. */
export const NOTIFICATION_PREFERENCES_STORAGE_KEY = "spindle-notification-preferences"

/** localStorage key for the persisted notification feed (inbox). */
export const NOTIFICATION_FEED_STORAGE_KEY = "spindle-notifications-feed"

/**
 * localStorage flag recording that the seeded demo feed has been delivered
 * once. Once set, an absent/corrupt feed storage never re-seeds — otherwise
 * dismissing every demo item (or clearing the feed key) would resurrect the
 * whole seed list on the next visit.
 */
export const NOTIFICATION_SEEDS_STORAGE_KEY = "spindle-notification-seeds-shown"

export interface AppNotification {
  id: string
  type: AppNotificationType
  title: string
  body: string
  href?: string
  createdAt: string
  read: boolean
  /** Optional category — drives per-category preference filtering. */
  category?: AppNotificationCategory
  /**
   * Optional project association — powers the project filter on the
   * notifications page. Untagged notifications only appear under "All".
   */
  projectId?: string
  /** True for seeded preview items — rendered with a "(demo)" marker. */
  demo?: boolean
  /** Explicit thread subject; falls back to the normalized title. */
  subject?: string
  /** Inline action buttons rendered on the inbox row. */
  actions?: NotificationAction[]
  /** ISO instant until which the notification is snoozed (hidden, then re-surfaces). */
  snoozedUntil?: string
}

/**
 * Payload accepted by `notify()` / `pushAppNotification()`. `id`, `createdAt`,
 * and `read` are optional — the provider fills them in. Supplying a stable
 * `id` lets producers dedupe (e.g. retries of the same backend event).
 */
export type AppNotificationInput = Pick<AppNotification, "type" | "title" | "body"> &
  Partial<
    Pick<
      AppNotification,
      | "id"
      | "href"
      | "createdAt"
      | "read"
      | "demo"
      | "category"
      | "projectId"
      | "subject"
      | "actions"
      | "snoozedUntil"
    >
  >

export interface AppNotificationsContextValue {
  /** Feed items visible right now — snoozed items are hidden until they re-surface. */
  notifications: AppNotification[]
  unreadCount: number
  markRead: (id: string) => void
  markAllRead: () => void
  /** Flip a notification back to unread (published to other tabs/devices). */
  markUnread: (id: string) => void
  /** Flip read state based on the current value. */
  toggleRead: (id: string) => void
  /** Remove a notification from the feed entirely (published to other tabs/devices). */
  dismiss: (id: string) => void
  /**
   * Hide a notification until `untilIso`, then re-surface it. Snoozing is
   * local to this device — it is not published to other tabs.
   */
  snooze: (id: string, untilIso: string) => void
  /** Execute an action declared on a notification (custom href/snooze/dismiss). */
  performAction: (notification: AppNotification, action: NotificationAction) => void
  /** Push a notification into the feed; appears at the top, unread. */
  notify: (input: AppNotificationInput) => void
  /** Scheduled notifications persisted in localStorage. */
  schedules: NotificationSchedule[]
  /** Validate + persist a new schedule; null when the input is unusable. */
  addSchedule: (input: NotificationScheduleInput) => NotificationSchedule | null
  removeSchedule: (id: string) => void
  /** Patch schedule fields (used by the enabled toggle and edits). */
  updateSchedule: (id: string, patch: Partial<NotificationSchedule>) => void
  /** Current notification preferences (persisted to localStorage). */
  preferences: AppNotificationPreferences
  /**
   * Replace the preferences. Accepts a full object or an updater function;
   * the result is sanitized against the defaults before it is stored.
   */
  updatePreferences: (
    next:
      | AppNotificationPreferences
      | ((current: AppNotificationPreferences) => AppNotificationPreferences),
  ) => void
}

const NotificationsContext = createContext<AppNotificationsContextValue | null>(null)

/**
 * DOM CustomEvent name used for realtime delivery. Any code — React or not —
 * can push a notification with
 * `window.dispatchEvent(new CustomEvent(APP_NOTIFICATION_EVENT, { detail }))`.
 * `pushAppNotification()` is the typed helper for that.
 */
export const APP_NOTIFICATION_EVENT = "spindle:app-notification"

/** BroadcastChannel name for cross-tab realtime delivery (same origin). */
const NOTIFICATION_CHANNEL = "spindle-notifications"

/** Hard cap so a noisy producer cannot grow the feed without bound. */
const MAX_NOTIFICATIONS = 50

/** Fresh copy of the default preferences — categories are mutable, so callers must not share one instance. */
export function defaultNotificationPreferences(): AppNotificationPreferences {
  return {
    inApp: true,
    muted: false,
    email: false,
    system: true,
    categories: {
      activity: { inApp: true, email: false },
      agent: { inApp: true, email: true },
      automation: { inApp: true, email: false },
      lab: { inApp: true, email: false },
      mentions: { inApp: true, email: true },
      product: { inApp: true, email: false },
      // Security alerts default to email-on so account-protection events are
      // not silently dropped; the settings UI still lets users opt out.
      security: { inApp: true, email: true },
    },
    projects: {},
    digestFrequency: "weekly",
    sound: { enabled: true, tone: "chime" },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Merge an untrusted value (localStorage blob, cross-tab storage event,
 * `updatePreferences` argument) over the defaults so a corrupt or partial
 * payload can never produce an invalid preferences object.
 */
function sanitizeNotificationPreferences(value: unknown): AppNotificationPreferences {
  const defaults = defaultNotificationPreferences()
  if (!isRecord(value)) return defaults

  const preferences: AppNotificationPreferences = {
    ...defaults,
    categories: { ...defaults.categories },
    projects: {},
  }

  if (typeof value.inApp === "boolean") preferences.inApp = value.inApp
  if (typeof value.muted === "boolean") preferences.muted = value.muted
  if (typeof value.email === "boolean") preferences.email = value.email
  if (typeof value.system === "boolean") preferences.system = value.system
  if (
    typeof value.digestFrequency === "string" &&
    (APP_NOTIFICATION_DIGEST_FREQUENCIES as readonly string[]).includes(value.digestFrequency)
  ) {
    preferences.digestFrequency = value.digestFrequency as AppNotificationDigestFrequency
  }

  if (isRecord(value.sound)) {
    const storedSound = value.sound
    preferences.sound = {
      enabled:
        typeof storedSound.enabled === "boolean" ? storedSound.enabled : defaults.sound.enabled,
      tone:
        typeof storedSound.tone === "string" &&
        (APP_NOTIFICATION_SOUND_TONES as readonly string[]).includes(storedSound.tone)
          ? (storedSound.tone as AppNotificationSoundTone)
          : defaults.sound.tone,
    }
  }

  if (isRecord(value.categories)) {
    for (const category of APP_NOTIFICATION_CATEGORIES) {
      const stored = value.categories[category]
      if (!isRecord(stored)) continue
      preferences.categories[category] = {
        inApp:
          typeof stored.inApp === "boolean" ? stored.inApp : defaults.categories[category].inApp,
        email:
          typeof stored.email === "boolean" ? stored.email : defaults.categories[category].email,
      }
    }
  }

  if (isRecord(value.projects)) {
    for (const [projectId, storedProject] of Object.entries(value.projects)) {
      if (!isRecord(storedProject)) continue
      const project: AppNotificationProjectPreferences = { muted: false, categories: {} }
      if (typeof storedProject.muted === "boolean") project.muted = storedProject.muted
      if (isRecord(storedProject.categories)) {
        for (const category of APP_NOTIFICATION_CATEGORIES) {
          const storedCategory = storedProject.categories[category]
          if (!isRecord(storedCategory)) continue
          const override: Partial<AppNotificationCategoryPreferences> = {}
          if (typeof storedCategory.inApp === "boolean") override.inApp = storedCategory.inApp
          if (typeof storedCategory.email === "boolean") override.email = storedCategory.email
          if (override.inApp !== undefined || override.email !== undefined) {
            project.categories[category] = override
          }
        }
      }
      // Drop entries that carry no overrides so the stored blob stays small.
      if (project.muted || Object.keys(project.categories).length > 0) {
        preferences.projects[projectId] = project
      }
    }
  }

  return preferences
}

function readStoredPreferences(): AppNotificationPreferences {
  if (typeof window === "undefined") return defaultNotificationPreferences()
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)
    if (!raw) return defaultNotificationPreferences()
    return sanitizeNotificationPreferences(JSON.parse(raw))
  } catch {
    return defaultNotificationPreferences()
  }
}

/**
 * Normalize one stored feed item. Stricter than `isAppNotificationInput` —
 * stored items must already be materialized (id/createdAt/read present) and
 * categories must be known values so a corrupt blob cannot inject junk.
 */
function sanitizeStoredNotification(value: unknown): AppNotification | null {
  if (!isAppNotificationInput(value)) return null
  const candidate = value as AppNotificationInput & { id?: unknown; createdAt?: unknown }
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null
  if (typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt))) {
    return null
  }
  if (typeof candidate.read !== "boolean") return null
  return toNotification({ ...candidate, id: candidate.id })
}

/**
 * Read the persisted inbox. Returns null only when the storage key is absent
 * or unparseable, so the caller can distinguish "never persisted" (seed the
 * demo feed once) from "persisted but empty" (user dismissed everything).
 * Stored items keep their order (newest first).
 */
function readStoredFeed(): AppNotification[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_FEED_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const items = parsed
      .map(sanitizeStoredNotification)
      .filter((item): item is AppNotification => item !== null)
      .slice(0, MAX_NOTIFICATIONS)
    // An empty array is a valid stored feed (the user dismissed everything) —
    // return it so the caller does not fall back to re-seeding.
    return items
  } catch {
    return null
  }
}

function notificationSeedsShown(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(NOTIFICATION_SEEDS_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function markNotificationSeedsShown() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(NOTIFICATION_SEEDS_STORAGE_KEY, "1")
  } catch {
    // Storage unavailable — seeds may re-appear next visit; harmless for demo data.
  }
}

function initialFeed(initialNotifications?: AppNotification[]): AppNotification[] {
  if (initialNotifications) return initialNotifications
  const stored = readStoredFeed()
  // A persisted feed — even an empty one — means the seeds were already
  // delivered and dismissed/read items must not come back.
  if (stored) return stored
  if (notificationSeedsShown()) return []
  markNotificationSeedsShown()
  return createMockNotifications()
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function createMockNotifications(): AppNotification[] {
  return [
    {
      id: "ntf_storage",
      type: "warning",
      title: "Storage is nearing the workspace limit",
      body: "Coastal resilience is using most of the available file storage.",
      href: "/app/settings",
      createdAt: minutesAgo(8),
      read: false,
      demo: true,
    },
    {
      id: "ntf_agent",
      type: "error",
      title: "Agent run needs review",
      body: "The nightly diff finished with two unresolved comments.",
      href: "/app/agent",
      projectId: "prj_01",
      createdAt: minutesAgo(26),
      read: false,
      demo: true,
    },
    {
      id: "ntf_lab",
      type: "success",
      title: "Lab session completed",
      body: "Wave tank calibration finished and the results are ready.",
      href: "/app/lab",
      projectId: "prj_02",
      createdAt: minutesAgo(95),
      read: false,
      demo: true,
    },
    {
      id: "ntf_chat",
      type: "info",
      title: "New reply in project chat",
      body: "A teammate replied in the coastal resilience conversation.",
      href: "/app/chat",
      projectId: "prj_01",
      createdAt: minutesAgo(180),
      read: false,
      demo: true,
    },
    {
      id: "ntf_files",
      type: "info",
      title: "Files synced",
      body: "Twelve files were imported into the workspace files library.",
      href: "/app/files",
      createdAt: minutesAgo(1440),
      read: true,
      demo: true,
    },
    {
      id: "ntf_weekly",
      type: "info",
      title: "Weekly digest is ready",
      body: "Your workspace summary for last week is available.",
      href: "/dashboard",
      createdAt: minutesAgo(4320),
      read: true,
      demo: true,
    },
  ]
}

let notificationCounter = 0

function toNotification(input: AppNotificationInput): AppNotification {
  notificationCounter += 1
  // Runtime-hardening: `notify()`/`pushAppNotification()` accept untyped
  // producer payloads, so coerce every field instead of trusting the type —
  // a bogus `type` would otherwise crash `NOTIFICATION_ICONS[type]` lookups.
  const type = NOTIFICATION_TYPES.includes(input.type) ? input.type : "info"
  const createdAt =
    typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))
      ? new Date(Date.parse(input.createdAt)).toISOString()
      : new Date().toISOString()
  const snoozedUntil =
    typeof input.snoozedUntil === "string" && !Number.isNaN(Date.parse(input.snoozedUntil))
      ? input.snoozedUntil
      : undefined
  return {
    id:
      typeof input.id === "string" && input.id.length > 0
        ? input.id
        : `ntf_live_${Date.now().toString(36)}_${notificationCounter}`,
    type,
    title: typeof input.title === "string" ? input.title : "",
    body: typeof input.body === "string" ? input.body : "",
    href: isSafeNotificationHref(input.href) ? input.href : undefined,
    createdAt,
    read: input.read === true,
    category: isAppNotificationCategory(input.category) ? input.category : undefined,
    projectId: typeof input.projectId === "string" ? input.projectId : undefined,
    demo: input.demo === true ? true : undefined,
    subject: typeof input.subject === "string" ? input.subject : undefined,
    actions: input.actions ? sanitizeNotificationActions(input.actions) : undefined,
    snoozedUntil,
  }
}

const NOTIFICATION_TYPES: readonly AppNotificationType[] = ["info", "success", "warning", "error"]

const APP_NOTIFICATION_CATEGORY_SET: ReadonlySet<string> = new Set(APP_NOTIFICATION_CATEGORIES)

function isAppNotificationCategory(value: unknown): value is AppNotificationCategory {
  return typeof value === "string" && APP_NOTIFICATION_CATEGORY_SET.has(value)
}

/**
 * Normalize a wire `NotificationPayload` into provider input: the wire
 * allows any category string, but the feed only honors known categories.
 */
function streamPayloadToInput(payload: NotificationPayload): AppNotificationInput {
  return {
    ...payload,
    category: isAppNotificationCategory(payload.category) ? payload.category : undefined,
  }
}

function isAppNotificationInput(value: unknown): value is AppNotificationInput {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<AppNotificationInput>
  return (
    typeof candidate.type === "string" &&
    NOTIFICATION_TYPES.includes(candidate.type as AppNotificationType) &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    (candidate.category === undefined ||
      (APP_NOTIFICATION_CATEGORIES as readonly string[]).includes(candidate.category)) &&
    (candidate.projectId === undefined || typeof candidate.projectId === "string") &&
    (candidate.subject === undefined || typeof candidate.subject === "string") &&
    (candidate.snoozedUntil === undefined || typeof candidate.snoozedUntil === "string") &&
    (candidate.actions === undefined ||
      (Array.isArray(candidate.actions) &&
        candidate.actions.length <= 5 &&
        candidate.actions.every(isNotificationAction)))
  )
}

/**
 * Push a notification to every mounted `AppNotificationsProvider` — the
 * current tab via a window CustomEvent and other same-origin tabs via
 * BroadcastChannel. Safe to call from non-React code (service worker message
 * handlers, sync engines, etc.). No-ops during SSR.
 */
export function pushAppNotification(input: AppNotificationInput) {
  if (typeof window === "undefined") return
  const detail = toNotification(input)
  window.dispatchEvent(new CustomEvent<AppNotification>(APP_NOTIFICATION_EVENT, { detail }))
  try {
    const channel = new BroadcastChannel(NOTIFICATION_CHANNEL)
    channel.postMessage(detail)
    channel.close()
  } catch {
    // BroadcastChannel unavailable (older browsers, some test envs) — the
    // same-tab CustomEvent above still delivers.
  }
}

/**
 * Fire-and-forget publish to `POST /api/notifications`, which fans the event
 * out over SSE to the caller's other tabs/devices. Never throws and no-ops
 * during SSR or when fetch is unavailable (tests, very old browsers) — the
 * in-tab delivery paths (CustomEvent/BroadcastChannel) remain the fallback.
 */
function publishStreamEvent(event: NotificationStreamEvent) {
  if (typeof window === "undefined" || typeof fetch === "undefined") return
  try {
    void fetch(NOTIFICATION_PUBLISH_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {})
  } catch {
    // Network/fetch failures are irrelevant — realtime is best-effort.
  }
}

export function AppNotificationsProvider({
  children,
  initialNotifications,
}: {
  children: ReactNode
  initialNotifications?: AppNotification[]
}) {
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    initialFeed(initialNotifications),
  )
  // When the caller seeds the feed explicitly (tests, previews) it is treated
  // as authoritative and is NOT persisted — persisting a test fixture would
  // leak it into the real inbox on the next visit.
  const persistFeed = initialNotifications === undefined
  // Preferences start at the defaults on both server and client so the first
  // render hydrates cleanly; the stored blob is applied in a mount effect
  // below. Reading localStorage in the initializer would mismatch the server
  // HTML (Switch/select state) on pages that render preferences.
  const [preferences, setPreferences] = useState<AppNotificationPreferences>(
    defaultNotificationPreferences,
  )
  // `deliver` is a stable callback, so it reads the latest preferences through
  // a ref instead of closing over state (which would retrigger every effect
  // that depends on `deliver`/`ingest` on each preference change).
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  // Scheduled notifications — hydrated from localStorage after mount (same
  // SSR-safe pattern as preferences), persisted on every change, and kept in
  // sync across tabs via the storage event.
  const [schedules, setSchedules] = useState<NotificationSchedule[]>([])
  const schedulesRef = useRef(schedules)
  schedulesRef.current = schedules
  // Full feed (including snoozed items) for read-state lookups in callbacks —
  // the public `notifications` value is the visible-only projection below.
  const notificationsRef = useRef(notifications)
  notificationsRef.current = notifications

  useEffect(() => {
    setSchedules(loadNotificationSchedules())
  }, [])

  useEffect(() => {
    saveNotificationSchedules(schedules)
  }, [schedules])

  const updatePreferences = useCallback(
    (
      next:
        | AppNotificationPreferences
        | ((current: AppNotificationPreferences) => AppNotificationPreferences),
    ) => {
      setPreferences((current) =>
        sanitizeNotificationPreferences(typeof next === "function" ? next(current) : next),
      )
    },
    [],
  )

  // Restore persisted preferences after mount. This effect must run BEFORE
  // the persist effect below: on the first commit both see the default state,
  // so the persist effect briefly rewrites defaults — harmless because this
  // effect already captured the stored value, and the next render persists
  // the restored preferences back.
  useEffect(() => {
    setPreferences(readStoredPreferences())
  }, [])

  // Persist preferences whenever they change, and pick up writes from other
  // tabs (same pattern as useAppTheme).
  useEffect(() => {
    try {
      window.localStorage.setItem(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
    } catch {
      // Storage can be unavailable (private mode); preferences still apply
      // for this session via React state.
    }
  }, [preferences])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      // `key === null` means localStorage.clear() ran in another tab — treat
      // it as a reset to defaults.
      if (event.key === null) {
        setPreferences(defaultNotificationPreferences())
        return
      }
      if (event.key !== NOTIFICATION_PREFERENCES_STORAGE_KEY) return
      if (event.newValue === null) {
        setPreferences(defaultNotificationPreferences())
        return
      }
      try {
        setPreferences(sanitizeNotificationPreferences(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep current preferences.
      }
    }

    function onSchedulesStorage(event: StorageEvent) {
      if (event.key !== NOTIFICATION_SCHEDULES_STORAGE_KEY) return
      if (event.newValue === null) {
        setSchedules([])
        return
      }
      try {
        setSchedules(sanitizeNotificationSchedules(JSON.parse(event.newValue)))
      } catch {
        // Corrupt payload from another tab — keep current schedules.
      }
    }

    window.addEventListener("storage", onStorage)
    window.addEventListener("storage", onSchedulesStorage)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("storage", onSchedulesStorage)
    }
  }, [])

  // Persist the inbox so read state and live items survive reloads. Skipped
  // entirely when the feed was seeded via `initialNotifications`.
  useEffect(() => {
    if (!persistFeed) return
    try {
      window.localStorage.setItem(NOTIFICATION_FEED_STORAGE_KEY, JSON.stringify(notifications))
    } catch {
      // Storage can be unavailable (private mode); the feed still works
      // for this session via React state.
    }
  }, [notifications, persistFeed])

  // `applyRead`/`applyAllRead` mutate local state only; the public
  // `markRead`/`markAllRead` additionally publish the change so other tabs
  // and devices converge. Remote events must use the apply* variants or the
  // echo would republish forever.
  const applyRead = useCallback((id: string) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    )
  }, [])

  const applyUnread = useCallback((id: string) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: false } : notification,
      ),
    )
  }, [])

  const applyAllRead = useCallback(() => {
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })))
  }, [])

  const applyDismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id))
  }, [])

  const applySnooze = useCallback((id: string, untilIso: string) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, snoozedUntil: untilIso } : notification,
      ),
    )
  }, [])

  const markRead = useCallback(
    (id: string) => {
      applyRead(id)
      publishStreamEvent({ type: "read", id })
      const notification = notificationsRef.current.find((item) => item.id === id)
      trackNotificationAction("mark_read", { category: notification?.category })
    },
    [applyRead],
  )

  const markAllRead = useCallback(() => {
    applyAllRead()
    publishStreamEvent({ type: "read_all" })
    trackNotificationAction("mark_all_read")
  }, [applyAllRead])

  const markUnread = useCallback(
    (id: string) => {
      applyUnread(id)
      publishStreamEvent({ type: "unread", id })
      const notification = notificationsRef.current.find((item) => item.id === id)
      trackNotificationAction("mark_unread", { category: notification?.category })
    },
    [applyUnread],
  )

  const toggleRead = useCallback(
    (id: string) => {
      const notification = notificationsRef.current.find((item) => item.id === id)
      if (!notification) return
      if (notification.read) {
        markUnread(id)
      } else {
        applyRead(id)
        publishStreamEvent({ type: "read", id })
        trackNotificationAction("mark_read", { category: notification.category })
      }
    },
    [applyRead, markUnread],
  )

  const dismiss = useCallback(
    (id: string) => {
      const notification = notificationsRef.current.find((item) => item.id === id)
      applyDismiss(id)
      publishStreamEvent({ type: "dismiss", id })
      trackNotificationAction("dismiss", { category: notification?.category })
    },
    [applyDismiss],
  )

  const snooze = useCallback(
    (id: string, untilIso: string) => {
      const notification = notificationsRef.current.find((item) => item.id === id)
      applySnooze(id, untilIso)
      trackNotificationAction("snooze", { category: notification?.category })
    },
    [applySnooze],
  )

  /**
   * Run an action declared on a notification. When an action sets several
   * behavior fields, precedence is `dismiss` > `snoozeMinutes` > `href`
   * (custom/mark-read): `dismiss` removes the item, `snoozeMinutes` hides it
   * for that long, and anything else (plain or `href`) marks the
   * notification read — href actions navigate via their rendered link. All
   * paths emit telemetry.
   */
  const performAction = useCallback(
    (notification: AppNotification, action: NotificationAction) => {
      if (action.dismiss) {
        dismiss(notification.id)
        return
      }
      if (typeof action.snoozeMinutes === "number") {
        snooze(notification.id, new Date(Date.now() + action.snoozeMinutes * 60_000).toISOString())
        return
      }
      trackNotificationAction("custom", {
        category: notification.category,
        actionId: action.id,
      })
      markRead(notification.id)
    },
    [dismiss, snooze, markRead],
  )

  /**
   * Insert a notification at the top of the feed. A repeated id (publisher
   * echo, retry, cross-tab BroadcastChannel + SSE double delivery) merges
   * read state only — it never re-fires sound/OS notifications or resets a
   * read item back to unread. In-app delivery is suppressed by the
   * preferences: the master `inApp` and
   * `muted` switches, the per-category `inApp` flag when the producer tagged
   * the notification with a category, and any project-level overrides stored
   * under `preferences.projects[projectId]` (a muted project drops every
   * tagged notification; a category override wins over the global category
   * flag for that project). Suppressed notifications are
   * still published to other tabs/devices — each recipient applies its own
   * preferences.
   */
  const deliver = useCallback(
    (notification: AppNotification) => {
      // Echo/retry of an id already in the feed: merge read state only.
      // Re-firing sound + OS notification — or resetting a just-read item
      // back to unread via the incoming payload — on the publisher's own
      // SSE/BroadcastChannel echo is a bug, so side effects are skipped
      // entirely for duplicates. Read state still converges: an incoming
      // `read: true` marks the local copy read, but an incoming `read:
      // false` never flips a read item back.
      const existing = notificationsRef.current.find((item) => item.id === notification.id)
      if (existing) {
        if (notification.read && !existing.read) applyRead(notification.id)
        return
      }
      const prefs = preferencesRef.current
      const projectPrefs = notification.projectId
        ? prefs.projects[notification.projectId]
        : undefined
      if (projectPrefs?.muted) return
      const categoryAllowed =
        !notification.category ||
        (projectPrefs?.categories[notification.category]?.inApp ??
          prefs.categories[notification.category].inApp)
      if (!prefs.inApp || prefs.muted || !categoryAllowed) return
      // Sound plays only for notifications actually delivered to this tab's
      // feed — suppressed deliveries (master/category/mute) stay silent.
      playNotificationSound(prefs.sound)
      // Mirror to the OS notification center when the user granted permission
      // and kept the system channel enabled. No-ops everywhere else.
      if (prefs.system) {
        showSystemNotification({
          title: notification.title,
          body: notification.body,
          href: notification.href,
          tag: notification.id,
        })
      }
      setNotifications((current) =>
        [notification, ...current.filter((existing) => existing.id !== notification.id)].slice(
          0,
          MAX_NOTIFICATIONS,
        ),
      )
    },
    [applyRead],
  )

  const ingest = useCallback(
    (input: AppNotificationInput) => deliver(toNotification(input)),
    [deliver],
  )

  /**
   * Push a notification into this tab's feed and forward it to other tabs via
   * BroadcastChannel. Same-tab delivery goes through `deliver` directly —
   * BroadcastChannel never echoes to the posting context.
   */
  const notify = useCallback(
    (input: AppNotificationInput) => {
      const notification = toNotification(input)
      deliver(notification)
      // Publish the materialized notification (stable id/createdAt) so the
      // server echo dedupes cleanly against this tab's local copy.
      publishStreamEvent({ type: "notification", notification })
      try {
        const channel = new BroadcastChannel(NOTIFICATION_CHANNEL)
        channel.postMessage(notification)
        channel.close()
      } catch {
        // BroadcastChannel unavailable — same-tab delivery already happened.
      }
    },
    [deliver],
  )

  // Realtime delivery: same-tab CustomEvents plus cross-tab BroadcastChannel
  // messages both funnel into `ingest`, so the bell and the notifications page
  // update live without a refetch. Incoming payloads are already
  // AppNotifications (ids assigned), so `toNotification` inside `ingest`
  // preserves them.
  useEffect(() => {
    function onWindowEvent(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail
      if (!isAppNotificationInput(detail)) return
      // Window CustomEvents are locally produced (e.g. pushAppNotification) —
      // materialize once so the id is stable, then fan out to the server
      // channel so other tabs/devices converge. Remote SSE deliveries never
      // dispatch this event, so there is no publish loop.
      const notification = toNotification(detail)
      deliver(notification)
      publishStreamEvent({ type: "notification", notification })
    }

    function onChannelMessage(event: MessageEvent<unknown>) {
      if (isAppNotificationInput(event.data)) ingest(event.data)
    }

    // Web-push mirror: public/sw.js postMessages { type: "spindle-push",
    // payload } to window clients whenever a push arrives, so open tabs see
    // the same notification the OS banner shows.
    function onServiceWorkerMessage(event: MessageEvent<unknown>) {
      const data = event.data as { type?: unknown; payload?: unknown } | null
      if (data?.type === "spindle-push" && isAppNotificationInput(data.payload)) {
        ingest(data.payload)
      }
    }

    window.addEventListener(APP_NOTIFICATION_EVENT, onWindowEvent)
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined
    sw?.addEventListener("message", onServiceWorkerMessage)
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(NOTIFICATION_CHANNEL)
      channel.addEventListener("message", onChannelMessage)
    } catch {
      channel = null
    }
    return () => {
      window.removeEventListener(APP_NOTIFICATION_EVENT, onWindowEvent)
      sw?.removeEventListener("message", onServiceWorkerMessage)
      channel?.removeEventListener("message", onChannelMessage)
      channel?.close()
    }
  }, [ingest, deliver])

  // Server realtime: subscribe to the SSE feed so notifications published by
  // other tabs/devices (or future backend producers) appear live. Remote
  // events go through `ingest`/`applyRead`/`applyAllRead` — never `notify`,
  // `markRead`, or `markAllRead` — so echoes cannot republish. When
  // EventSource is missing or the endpoint rejects the session, the effect
  // simply does nothing and the CustomEvent/BroadcastChannel paths above
  // keep working unchanged (graceful fallback).
  useEffect(() => {
    if (typeof EventSource === "undefined") return

    const source = new EventSource(NOTIFICATION_STREAM_PATH)

    function onStreamMessage(event: MessageEvent) {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!isNotificationStreamEvent(parsed)) return
      if (parsed.type === "notification") {
        ingest(streamPayloadToInput(parsed.notification))
      } else if (parsed.type === "read") {
        applyRead(parsed.id)
      } else if (parsed.type === "unread") {
        applyUnread(parsed.id)
      } else if (parsed.type === "dismiss") {
        applyDismiss(parsed.id)
      } else {
        applyAllRead()
      }
    }

    source.addEventListener("message", onStreamMessage)
    return () => {
      source.removeEventListener("message", onStreamMessage)
      source.close()
    }
  }, [ingest, applyRead, applyUnread, applyDismiss, applyAllRead])

  /* ---------------------------------------------------------------- */
  /* Scheduled notifications                                           */
  /* ---------------------------------------------------------------- */

  const addSchedule = useCallback((input: NotificationScheduleInput) => {
    const schedule = buildNotificationSchedule(input)
    if (!schedule) return null
    setSchedules((current) => [...current, schedule].slice(-50))
    return schedule
  }, [])

  const removeSchedule = useCallback((id: string) => {
    setSchedules((current) => current.filter((schedule) => schedule.id !== id))
  }, [])

  const updateSchedule = useCallback((id: string, patch: Partial<NotificationSchedule>) => {
    setSchedules((current) =>
      sanitizeNotificationSchedules(
        current.map((schedule) => (schedule.id === id ? { ...schedule, ...patch } : schedule)),
      ),
    )
  }, [])

  /**
   * Deliver a due schedule through the normal notification pipeline. The id
   * is deterministic per occurrence (`fireAt`) so a double-fired timer still
   * dedupes to a single feed item.
   */
  const fireSchedule = useCallback(
    (schedule: NotificationSchedule) => {
      const category = isAppNotificationCategory(schedule.category) ? schedule.category : undefined
      notify({
        id: `ntf_sched_${schedule.id}_${schedule.fireAt}`,
        type: schedule.type,
        title: schedule.title,
        body: schedule.body || "Scheduled notification",
        href: schedule.href,
        category,
      })
      setSchedules((current) => advanceNotificationSchedule(current, schedule.id, Date.now()))
    },
    [notify],
  )

  // Scheduler engine: fire every enabled schedule whose `fireAt` has passed,
  // then arm a single timeout for the earliest pending occurrence. The tick
  // state re-runs the effect when the timeout fires; `schedules` changes
  // (add/remove/toggle/advance) retrigger it naturally.
  const [scheduleTick, setScheduleTick] = useState(0)
  useEffect(() => {
    void scheduleTick // re-run trigger only
    const now = Date.now()
    const pending = schedulesRef.current.filter(
      (schedule) => schedule.enabled && !Number.isNaN(Date.parse(schedule.fireAt)),
    )
    const due = pending.filter((schedule) => Date.parse(schedule.fireAt) <= now)
    for (const schedule of due) {
      fireSchedule(schedule)
    }
    if (due.length > 0) return // state update retriggers this effect

    const futureTimes = pending
      .map((schedule) => Date.parse(schedule.fireAt))
      .filter((time) => time > now)
    if (futureTimes.length === 0) return

    // setTimeout caps at ~24.8 days; recurring schedules never exceed a week.
    const delay = Math.min(Math.max(0, Math.min(...futureTimes) - now), 2_000_000_000)
    const timeout = setTimeout(() => setScheduleTick((tick) => tick + 1), delay)
    return () => clearTimeout(timeout)
  }, [schedules, scheduleTick, fireSchedule])

  // Snoozed items are hidden until `snoozedUntil` passes; a single timeout
  // armed for the earliest pending wake re-surfaces them. `nowTick` forces
  // the visible projection to recompute when the timer fires.
  const [nowTick, setNowTick] = useState(0)
  useEffect(() => {
    void nowTick
    const now = Date.now()
    const wakeTimes = notifications
      .map((notification) =>
        notification.snoozedUntil ? Date.parse(notification.snoozedUntil) : Number.NaN,
      )
      .filter((time) => !Number.isNaN(time) && time > now)
    if (wakeTimes.length === 0) return
    const timeout = setTimeout(
      () => setNowTick((tick) => tick + 1),
      Math.min(Math.max(0, Math.min(...wakeTimes) - now), 2_000_000_000),
    )
    return () => clearTimeout(timeout)
  }, [notifications, nowTick])

  const visibleNotifications = useMemo(() => {
    void nowTick
    const now = Date.now()
    return notifications.filter((notification) => {
      // An unparseable snoozedUntil (corrupt storage, bad producer payload)
      // must not hide the item forever — treat it as not snoozed.
      const until = notification.snoozedUntil ? Date.parse(notification.snoozedUntil) : Number.NaN
      return Number.isNaN(until) || until <= now
    })
  }, [notifications, nowTick])

  const unreadCount = useMemo(
    () =>
      visibleNotifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0),
    [visibleNotifications],
  )

  const value = useMemo<AppNotificationsContextValue>(
    () => ({
      notifications: visibleNotifications,
      unreadCount,
      markRead,
      markAllRead,
      markUnread,
      toggleRead,
      dismiss,
      snooze,
      performAction,
      notify,
      schedules,
      addSchedule,
      removeSchedule,
      updateSchedule,
      preferences,
      updatePreferences,
    }),
    [
      visibleNotifications,
      unreadCount,
      markRead,
      markAllRead,
      markUnread,
      toggleRead,
      dismiss,
      snooze,
      performAction,
      notify,
      schedules,
      addSchedule,
      removeSchedule,
      updateSchedule,
      preferences,
      updatePreferences,
    ],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useAppNotifications() {
  const context = useContext(NotificationsContext)
  if (!context) {
    throw new Error("useAppNotifications must be used within AppNotificationsProvider")
  }
  return context
}
