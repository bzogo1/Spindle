import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  APP_NOTIFICATION_EVENT,
  AppNotificationsProvider,
  NOTIFICATION_FEED_STORAGE_KEY,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  NOTIFICATION_SEEDS_STORAGE_KEY,
  defaultNotificationPreferences,
  pushAppNotification,
  useAppNotifications,
  type AppNotification,
  type AppNotificationInput,
  type AppNotificationsContextValue,
} from "./notifications-provider"

function buildNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "ntf_seed",
    type: "info",
    title: "Seed notification",
    body: "Seed body",
    createdAt: new Date().toISOString(),
    read: false,
    ...overrides,
  }
}

/** Probe component exposing the context value for assertions. */
function Probe({ onValue }: { onValue: (value: AppNotificationsContextValue) => void }) {
  const value = useAppNotifications()
  onValue(value)
  return (
    <ul>
      {value.notifications.map((notification) => (
        <li key={notification.id} data-testid={`ntf-${notification.id}`}>
          {notification.title}:{notification.read ? "read" : "unread"}
        </li>
      ))}
    </ul>
  )
}

type StreamListener = (event: { data: string }) => void

/** Minimal EventSource stand-in for exercising the SSE subscription effect. */
class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  closed = false
  private listeners = new Map<string, Set<StreamListener>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: StreamListener) {
    let set = this.listeners.get(name)
    if (!set) {
      set = new Set()
      this.listeners.set(name, set)
    }
    set.add(listener)
  }

  removeEventListener(name: string, listener: StreamListener) {
    this.listeners.get(name)?.delete(listener)
  }

  emit(name: string, data: string) {
    for (const listener of this.listeners.get(name) ?? []) listener({ data })
  }

  close() {
    this.closed = true
  }
}

const originalEventSource = globalThis.EventSource
const originalFetch = globalThis.fetch
const originalAudioContext = window.AudioContext

function installEventSource() {
  MockEventSource.instances = []
  // @ts-expect-error test double for the SSE transport
  globalThis.EventSource = MockEventSource
}

function uninstallEventSource() {
  if (originalEventSource === undefined) {
    // @ts-expect-error jsdom does not provide EventSource
    delete globalThis.EventSource
  } else {
    globalThis.EventSource = originalEventSource
  }
}

/**
 * Minimal AudioContext stand-in for exercising the Web Audio notification
 * sound. jsdom does not implement Web Audio, so tests install this only when
 * they assert on playback.
 */
class MockAudioContext {
  static instances: MockAudioContext[] = []

  readonly state = "running"
  readonly currentTime = 0
  readonly destination = {}
  readonly resume = vi.fn().mockResolvedValue(undefined)
  readonly createOscillator = vi.fn(() => ({
    type: "",
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }))
  readonly createGain = vi.fn(() => ({
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }))

  constructor() {
    MockAudioContext.instances.push(this)
  }
}

function installAudioContext() {
  // The sound module caches the first AudioContext it creates, so clear call
  // counts on existing instances to keep per-test assertions isolated.
  for (const instance of MockAudioContext.instances) {
    instance.createOscillator.mockClear()
  }
  // @ts-expect-error test double for the Web Audio API
  window.AudioContext = MockAudioContext
}

/** Total oscillator creations across every context built so far. */
function oscillatorCallCount() {
  return MockAudioContext.instances.reduce(
    (count, instance) => count + instance.createOscillator.mock.calls.length,
    0,
  )
}

function uninstallAudioContext() {
  if (originalAudioContext === undefined) {
    // @ts-expect-error jsdom does not provide AudioContext
    delete window.AudioContext
  } else {
    window.AudioContext = originalAudioContext
  }
}

afterEach(() => {
  uninstallEventSource()
  uninstallAudioContext()
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function renderProvider(
  notifications: AppNotification[] = [],
  onValue?: (value: AppNotificationsContextValue) => void,
) {
  return render(
    <AppNotificationsProvider initialNotifications={notifications}>
      <Probe onValue={onValue ?? (() => {})} />
    </AppNotificationsProvider>,
  )
}

describe("AppNotificationsProvider", () => {
  it("exposes unreadCount derived from the feed", () => {
    renderProvider([
      buildNotification({ id: "a", read: false }),
      buildNotification({ id: "b", read: true }),
      buildNotification({ id: "c", read: false }),
    ])

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("unread")
    expect(screen.getByTestId("ntf-b")).toHaveTextContent("read")
  })

  it("markRead marks a single notification and markAllRead clears the rest", async () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "a" }), buildNotification({ id: "b" })], (value) => {
      api = value
    })

    act(() => api!.markRead("a"))
    expect(screen.getByTestId("ntf-a")).toHaveTextContent("read")
    expect(screen.getByTestId("ntf-b")).toHaveTextContent("unread")

    act(() => api!.markAllRead())
    expect(screen.getByTestId("ntf-b")).toHaveTextContent("read")
  })

  it("notify() prepends an unread notification and bumps unreadCount", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "seed", title: "Seed" })], (value) => {
      api = value
    })

    expect(api!.unreadCount).toBe(1)

    act(() => api!.notify({ type: "success", title: "Live update", body: "Something happened" }))

    expect(screen.getByTestId("ntf-seed")).toBeInTheDocument()
    const live = screen.getByText("Live update:unread")
    expect(live).toBeInTheDocument()
    // Newest first: the live item renders before the seed.
    const items = screen.getAllByRole("listitem")
    expect(items[0]).toHaveTextContent("Live update")
    expect(api!.unreadCount).toBe(2)
  })

  it("notify() dedupes an existing id instead of replacing it", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "dup", title: "Original" })], (value) => {
      api = value
    })

    // A repeated id (publisher echo or retry) must not duplicate the row or
    // overwrite the original content — read state still merges.
    act(() =>
      api!.notify({
        id: "dup",
        type: "info",
        title: "Updated",
        body: "New body",
        read: true,
      }),
    )

    expect(screen.queryByText("Updated:unread")).not.toBeInTheDocument()
    expect(screen.getByText("Original:read")).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })

  it("delivers realtime pushes dispatched as a window CustomEvent", () => {
    renderProvider([])

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_NOTIFICATION_EVENT, {
          detail: { type: "warning", title: "Realtime ping", body: "Via event" },
        }),
      )
    })

    expect(screen.getByText("Realtime ping:unread")).toBeInTheDocument()
  })

  it("delivers realtime pushes via pushAppNotification()", () => {
    renderProvider([])

    act(() => {
      pushAppNotification({ type: "error", title: "Push helper", body: "Via helper" })
    })

    expect(screen.getByText("Push helper:unread")).toBeInTheDocument()
  })

  it("delivers realtime pushes mirrored from the service worker", () => {
    const sw = new EventTarget()
    const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: sw,
    })
    try {
      renderProvider([])

      act(() => {
        sw.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "spindle-push",
              payload: {
                type: "info",
                title: "Push mirrored",
                body: "From the SW",
                href: "/app/files",
              },
            },
          }),
        )
      })

      expect(screen.getByText("Push mirrored:unread")).toBeInTheDocument()
    } finally {
      if (original) {
        Object.defineProperty(navigator, "serviceWorker", original)
      } else {
        Reflect.deleteProperty(navigator, "serviceWorker")
      }
    }
  })

  it("ignores malformed event payloads", () => {
    renderProvider([])

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_NOTIFICATION_EVENT, { detail: "nope" }))
      window.dispatchEvent(new CustomEvent(APP_NOTIFICATION_EVENT, { detail: null }))
    })

    expect(screen.queryAllByRole("listitem")).toHaveLength(0)
  })

  it("markAllRead publishes a read_all event to the notifications endpoint", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "a" }), buildNotification({ id: "b" })], (value) => {
      api = value
    })

    act(() => api!.markAllRead())

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "read_all" }),
      }),
    )
  })

  it("markRead publishes a read event for the notification id", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "a" })], (value) => {
      api = value
    })

    act(() => api!.markRead("a"))

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "read", id: "a" }),
      }),
    )
  })

  it("applies read_all stream events to the whole feed", () => {
    installEventSource()
    renderProvider([buildNotification({ id: "a" }), buildNotification({ id: "b" })])
    const source = MockEventSource.instances[0]
    expect(source.url).toBe("/api/notifications/stream")

    act(() => {
      source.emit("message", JSON.stringify({ type: "read_all" }))
    })

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("read")
    expect(screen.getByTestId("ntf-b")).toHaveTextContent("read")
  })

  it("applies read stream events to a single notification", () => {
    installEventSource()
    renderProvider([buildNotification({ id: "a" }), buildNotification({ id: "b" })])
    const source = MockEventSource.instances[0]

    act(() => {
      source.emit("message", JSON.stringify({ type: "read", id: "a" }))
    })

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("read")
    expect(screen.getByTestId("ntf-b")).toHaveTextContent("unread")
  })

  it("ignores malformed stream events", () => {
    installEventSource()
    renderProvider([buildNotification({ id: "a" })])
    const source = MockEventSource.instances[0]

    act(() => {
      source.emit("message", "not json")
      source.emit("message", JSON.stringify({ type: "read" }))
      source.emit("message", JSON.stringify({ type: "unknown" }))
      source.emit("message", JSON.stringify({ type: "read_all" }))
    })

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("read")
  })

  it("closes the stream subscription on unmount", () => {
    installEventSource()
    const { unmount } = renderProvider([buildNotification({ id: "a" })])
    const source = MockEventSource.instances[0]

    unmount()
    expect(source.closed).toBe(true)
  })

  it("plays a notification sound for each delivered notification", () => {
    installAudioContext()
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    // Default tone "chime" is a three-note sequence → three oscillators.
    act(() => api!.notify({ type: "info", title: "Ding", body: "Sound on" }))
    expect(oscillatorCallCount()).toBe(3)
  })

  it("does not play a sound when sound is disabled or delivery is suppressed", () => {
    installAudioContext()
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    act(() =>
      api!.updatePreferences((current) => ({
        ...current,
        sound: { ...current.sound, enabled: false },
      })),
    )
    act(() => api!.notify({ type: "info", title: "Silent", body: "Sound off" }))
    expect(oscillatorCallCount()).toBe(0)

    // Re-enable sound but mute delivery — suppressed notifications stay silent.
    act(() =>
      api!.updatePreferences((current) => ({
        ...current,
        muted: true,
        sound: { ...current.sound, enabled: true },
      })),
    )
    act(() => api!.notify({ type: "info", title: "Muted", body: "No feed, no sound" }))
    expect(oscillatorCallCount()).toBe(0)
  })

  it("plays the configured tone — a single-note blip uses one oscillator", () => {
    installAudioContext()
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    act(() =>
      api!.updatePreferences((current) => ({
        ...current,
        // Earlier tests may have persisted muted/sound-off state — reset both.
        muted: false,
        sound: { enabled: true, tone: "blip" },
      })),
    )
    act(() => api!.notify({ type: "info", title: "Blip", body: "One note" }))
    expect(oscillatorCallCount()).toBe(1)
  })

  it("suppresses in-app delivery for notifications from a muted project", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    act(() =>
      api!.updatePreferences({
        ...defaultNotificationPreferences(),
        projects: { prj_01: { muted: true, categories: {} } },
      }),
    )

    act(() =>
      api!.notify({
        type: "info",
        title: "Muted project ping",
        body: "Should not arrive",
        projectId: "prj_01",
      }),
    )
    act(() =>
      api!.notify({
        type: "info",
        title: "Other project ping",
        body: "Should arrive",
        projectId: "prj_02",
      }),
    )
    act(() => api!.notify({ type: "info", title: "Untagged ping", body: "Should arrive" }))

    expect(screen.queryByText("Muted project ping:unread")).not.toBeInTheDocument()
    expect(screen.getByText("Other project ping:unread")).toBeInTheDocument()
    expect(screen.getByText("Untagged ping:unread")).toBeInTheDocument()
  })

  it("lets project category overrides win over the global category preference", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    const defaults = defaultNotificationPreferences()
    act(() =>
      api!.updatePreferences({
        ...defaults,
        categories: { ...defaults.categories, agent: { inApp: false, email: true } },
        projects: {
          prj_01: {
            muted: false,
            categories: {
              agent: { inApp: true },
              activity: { inApp: false },
            },
          },
        },
      }),
    )

    act(() =>
      api!.notify({
        type: "info",
        title: "Agent override on",
        body: "Global agent is off, project turns it on",
        category: "agent",
        projectId: "prj_01",
      }),
    )
    act(() =>
      api!.notify({
        type: "info",
        title: "Agent global off",
        body: "No override for this project",
        category: "agent",
        projectId: "prj_02",
      }),
    )
    act(() =>
      api!.notify({
        type: "info",
        title: "Activity override off",
        body: "Global activity is on, project turns it off",
        category: "activity",
        projectId: "prj_01",
      }),
    )
    act(() =>
      api!.notify({
        type: "info",
        title: "Activity global on",
        body: "No override for this project",
        category: "activity",
        projectId: "prj_02",
      }),
    )

    expect(screen.getByText("Agent override on:unread")).toBeInTheDocument()
    expect(screen.queryByText("Agent global off:unread")).not.toBeInTheDocument()
    expect(screen.queryByText("Activity override off:unread")).not.toBeInTheDocument()
    expect(screen.getByText("Activity global on:unread")).toBeInTheDocument()
  })

  it("restores sanitized project overrides from localStorage", async () => {
    window.localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        projects: {
          prj_09: {
            muted: true,
            categories: {
              lab: { inApp: false, email: "yes" },
              notACategory: { inApp: true },
            },
          },
          // Entries without any override are dropped by the sanitizer.
          prj_empty: { muted: false, categories: {} },
          prj_junk: "not-an-object",
        },
      }),
    )

    let api: AppNotificationsContextValue | null = null
    try {
      renderProvider([], (value) => {
        api = value
      })
      // The stored blob is applied in a mount effect — flush it before asserting.
      await act(async () => {})

      expect(api!.preferences.projects.prj_09).toEqual({
        muted: true,
        categories: { lab: { inApp: false } },
      })
      expect(api!.preferences.projects.prj_empty).toBeUndefined()
      expect(api!.preferences.projects.prj_junk).toBeUndefined()

      act(() =>
        api!.notify({
          type: "info",
          title: "Stored mute works",
          body: "Muted via persisted prefs",
          projectId: "prj_09",
        }),
      )
      expect(screen.queryByText("Stored mute works:unread")).not.toBeInTheDocument()
    } finally {
      window.localStorage.removeItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)
    }
  })

  it("markUnread flips a notification back to unread and publishes the event", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "a", read: true })], (value) => {
      api = value
    })

    act(() => api!.markUnread("a"))

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("unread")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "unread", id: "a" }),
      }),
    )
  })

  it("toggleRead flips state in both directions", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider(
      [buildNotification({ id: "a", read: true }), buildNotification({ id: "b", read: false })],
      (value) => {
        api = value
      },
    )

    act(() => api!.toggleRead("a"))
    act(() => api!.toggleRead("b"))

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("unread")
    expect(screen.getByTestId("ntf-b")).toHaveTextContent("read")
  })

  it("dismiss removes a notification and publishes the event", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "a" }), buildNotification({ id: "b" })], (value) => {
      api = value
    })

    act(() => api!.dismiss("a"))

    expect(screen.queryByTestId("ntf-a")).not.toBeInTheDocument()
    expect(screen.getByTestId("ntf-b")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "dismiss", id: "a" }),
      }),
    )
  })

  it("applies unread and dismiss stream events remotely", () => {
    installEventSource()
    renderProvider([buildNotification({ id: "a", read: true }), buildNotification({ id: "b" })])
    const source = MockEventSource.instances[0]

    act(() => {
      source.emit("message", JSON.stringify({ type: "unread", id: "a" }))
      source.emit("message", JSON.stringify({ type: "dismiss", id: "b" }))
    })

    expect(screen.getByTestId("ntf-a")).toHaveTextContent("unread")
    expect(screen.queryByTestId("ntf-b")).not.toBeInTheDocument()
  })

  it("snoozes a notification out of the visible feed", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([buildNotification({ id: "a", title: "Later" })], (value) => {
      api = value
    })

    act(() => api!.snooze("a", new Date(Date.now() + 30 * 60_000).toISOString()))

    expect(screen.queryByText("Later:unread")).not.toBeInTheDocument()
    expect(api!.unreadCount).toBe(0)
    // The item is still in the underlying feed state — it re-surfaces later.
    expect(api!.notifications).toHaveLength(0)
  })

  it("performAction routes dismiss/snooze/custom actions", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider(
      [
        buildNotification({ id: "a", title: "Dismiss me" }),
        buildNotification({ id: "b", title: "Snooze me" }),
        buildNotification({ id: "c", title: "Open me", read: false }),
      ],
      (value) => {
        api = value
      },
    )

    const notificationA = api!.notifications.find((n) => n.id === "a")!
    const notificationB = api!.notifications.find((n) => n.id === "b")!
    const notificationC = api!.notifications.find((n) => n.id === "c")!

    act(() => api!.performAction(notificationA, { id: "x", label: "X", dismiss: true }))
    act(() => api!.performAction(notificationB, { id: "s", label: "S", snoozeMinutes: 60 }))
    act(() => api!.performAction(notificationC, { id: "v", label: "View", href: "/app/files" }))

    expect(screen.queryByText("Dismiss me:unread")).not.toBeInTheDocument()
    expect(screen.queryByText("Snooze me:unread")).not.toBeInTheDocument()
    expect(screen.getByText("Open me:read")).toBeInTheDocument()
  })

  it("adds, lists, toggles, and removes schedules persisted to localStorage", async () => {
    window.localStorage.removeItem("spindle-notification-schedules")
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    let created: ReturnType<AppNotificationsContextValue["addSchedule"]> = null
    act(() => {
      created = api!.addSchedule({
        title: "Water the plants",
        frequency: "daily",
        time: "09:00",
      })
    })

    expect(created).not.toBeNull()
    expect(api!.schedules).toHaveLength(1)
    expect(api!.schedules[0].title).toBe("Water the plants")

    const stored = JSON.parse(window.localStorage.getItem("spindle-notification-schedules") ?? "[]")
    expect(stored).toHaveLength(1)

    act(() => api!.updateSchedule(created!.id, { enabled: false }))
    expect(api!.schedules[0].enabled).toBe(false)

    act(() => api!.removeSchedule(created!.id))
    expect(api!.schedules).toHaveLength(0)
    window.localStorage.removeItem("spindle-notification-schedules")
  })

  it("fires an overdue one-shot schedule into the feed and removes it", async () => {
    window.localStorage.setItem(
      "spindle-notification-schedules",
      JSON.stringify([
        {
          id: "sch_due",
          title: "Overdue reminder",
          body: "Fire me",
          type: "info",
          frequency: "once",
          fireAt: new Date(Date.now() - 1000).toISOString(),
          enabled: true,
          createdAt: new Date(Date.now() - 5000).toISOString(),
        },
      ]),
    )

    render(
      <AppNotificationsProvider>
        <Probe onValue={() => {}} />
      </AppNotificationsProvider>,
    )
    // Mount effects (schedule hydrate → engine) need an async flush.
    await act(async () => {})

    expect(await screen.findByText(/Overdue reminder/)).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem("spindle-notification-schedules") ?? "[]")
    expect(stored).toHaveLength(0)
    window.localStorage.removeItem("spindle-notification-schedules")
  })

  it("persists the feed to localStorage when no seed is provided", async () => {
    window.localStorage.removeItem("spindle-notifications-feed")
    let api: AppNotificationsContextValue | null = null
    render(
      <AppNotificationsProvider>
        <Probe onValue={(value) => (api = value)} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})

    act(() => api!.notify({ type: "info", title: "Persisted ping", body: "Saved" }))
    await act(async () => {})

    const stored = JSON.parse(window.localStorage.getItem("spindle-notifications-feed") ?? "[]")
    expect(stored.some((item: { title?: string }) => item.title === "Persisted ping")).toBe(true)
    window.localStorage.removeItem("spindle-notifications-feed")
  })

  it("restores a persisted feed when no seed is provided", async () => {
    window.localStorage.setItem(
      "spindle-notifications-feed",
      JSON.stringify([
        {
          id: "ntf_stored",
          type: "success",
          title: "Stored item",
          body: "From storage",
          createdAt: new Date().toISOString(),
          read: true,
          category: "agent",
        },
        { junk: true },
      ]),
    )

    render(
      <AppNotificationsProvider>
        <Probe onValue={() => {}} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})

    expect(screen.getByText("Stored item:read")).toBeInTheDocument()
    window.localStorage.removeItem("spindle-notifications-feed")
  })

  it("dedupes publisher echoes: no double sound, no read-state reset", async () => {
    installEventSource()
    installAudioContext()
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    act(() => api!.notify({ id: "dup_1", type: "info", title: "Echo me", body: "b" }))
    expect(api!.notifications.filter((n) => n.id === "dup_1")).toHaveLength(1)
    const soundCallsAfterDeliver = oscillatorCallCount()
    expect(soundCallsAfterDeliver).toBeGreaterThan(0)

    // The server echoes the same payload back over SSE — delivery must not
    // re-fire sound or duplicate the feed row.
    const source = MockEventSource.instances[0]
    act(() => {
      source.emit(
        "message",
        JSON.stringify({
          type: "notification",
          notification: {
            type: "info",
            title: "Echo me",
            body: "b",
            id: "dup_1",
            read: false,
          },
        }),
      )
    })

    expect(api!.notifications.filter((n) => n.id === "dup_1")).toHaveLength(1)
    expect(oscillatorCallCount()).toBe(soundCallsAfterDeliver)

    // Marking read locally then receiving the stale unread echo must not
    // flip the item back.
    act(() => api!.markRead("dup_1"))
    act(() => {
      source.emit(
        "message",
        JSON.stringify({
          type: "notification",
          notification: {
            type: "info",
            title: "Echo me",
            body: "b",
            id: "dup_1",
            read: false,
          },
        }),
      )
    })
    expect(api!.notifications.find((n) => n.id === "dup_1")?.read).toBe(true)

    // …but a genuine read:true echo still converges read state.
    act(() => api!.markUnread("dup_1"))
    act(() => {
      source.emit(
        "message",
        JSON.stringify({
          type: "notification",
          notification: {
            type: "info",
            title: "Echo me",
            body: "b",
            id: "dup_1",
            read: true,
          },
        }),
      )
    })
    expect(api!.notifications.find((n) => n.id === "dup_1")?.read).toBe(true)
  })

  it("does not resurrect dismissed seed notifications on reload", async () => {
    window.localStorage.removeItem(NOTIFICATION_FEED_STORAGE_KEY)
    window.localStorage.removeItem(NOTIFICATION_SEEDS_STORAGE_KEY)

    const first = render(
      <AppNotificationsProvider>
        <Probe onValue={() => {}} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})
    expect(screen.getByText(/Storage is nearing the workspace limit/)).toBeInTheDocument()

    // Dismiss one seed, unmount (persisting the feed), remount.
    let secondApi: AppNotificationsContextValue | null = null
    const second = render(
      <AppNotificationsProvider>
        <Probe onValue={(value) => (secondApi = value)} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})
    act(() => secondApi!.dismiss("ntf_storage"))
    await act(async () => {})
    second.unmount()
    first.unmount()

    const third = render(
      <AppNotificationsProvider>
        <Probe onValue={() => {}} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})

    expect(screen.queryByText(/Storage is nearing the workspace limit/)).not.toBeInTheDocument()
    // Other seeds that were not dismissed remain.
    expect(screen.getAllByText(/Weekly digest is ready/)).toHaveLength(1)
    third.unmount()

    // With the feed key gone but the seeds-shown flag set, nothing re-seeds.
    window.localStorage.removeItem(NOTIFICATION_FEED_STORAGE_KEY)
    const fourth = render(
      <AppNotificationsProvider>
        <Probe onValue={() => {}} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})
    expect(screen.queryByText(/Agent run needs review/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Weekly digest is ready/)).not.toBeInTheDocument()
    fourth.unmount()

    window.localStorage.removeItem(NOTIFICATION_FEED_STORAGE_KEY)
    window.localStorage.removeItem(NOTIFICATION_SEEDS_STORAGE_KEY)
  })

  it("treats an unparseable snoozedUntil as not snoozed", async () => {
    window.localStorage.setItem(NOTIFICATION_SEEDS_STORAGE_KEY, "1")
    window.localStorage.setItem(
      NOTIFICATION_FEED_STORAGE_KEY,
      JSON.stringify([
        {
          id: "ntf_bad_snooze",
          type: "info",
          title: "Corrupt snooze",
          body: "b",
          createdAt: new Date().toISOString(),
          read: false,
          snoozedUntil: "not-a-date",
        },
      ]),
    )

    render(
      <AppNotificationsProvider>
        <Probe onValue={() => {}} />
      </AppNotificationsProvider>,
    )
    await act(async () => {})

    expect(await screen.findByText(/Corrupt snooze/)).toBeInTheDocument()
    window.localStorage.removeItem(NOTIFICATION_FEED_STORAGE_KEY)
    window.localStorage.removeItem(NOTIFICATION_SEEDS_STORAGE_KEY)
  })

  it("drops unsafe hrefs and coerces bogus type/category on notify", () => {
    let api: AppNotificationsContextValue | null = null
    renderProvider([], (value) => {
      api = value
    })

    act(() =>
      api!.notify({
        type: "bogus",
        title: "Hostile payload",
        body: "b",
        href: "javascript:alert(1)",
        category: "bogus",
        snoozedUntil: "not-a-date",
      } as unknown as AppNotificationInput),
    )

    const delivered = api!.notifications.find((n) => n.title === "Hostile payload")
    expect(delivered).toBeDefined()
    expect(delivered?.type).toBe("info")
    expect(delivered?.category).toBeUndefined()
    expect(delivered?.href).toBeUndefined()
    expect(delivered?.snoozedUntil).toBeUndefined()
    // The bogus type must not crash the icon lookup either.
    expect(screen.getByText("Hostile payload:unread")).toBeInTheDocument()
  })

  it("throws when used outside the provider", () => {
    function Orphan() {
      useAppNotifications()
      return null
    }

    expect(() => render(<Orphan />)).toThrow(
      "useAppNotifications must be used within AppNotificationsProvider",
    )
  })
})
