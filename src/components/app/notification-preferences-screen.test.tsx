import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  AppNotificationsProvider,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  pushAppNotification,
  useAppNotifications,
  type AppNotification,
  type AppNotificationsContextValue,
} from "./notifications-provider"
import { NotificationPreferencesScreen } from "./notification-preferences-screen"
import { defaultCommunicationPreferences } from "@/lib/communication-preferences"

function buildNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "ntf_1",
    type: "info",
    title: "Notification",
    body: "Notification body",
    createdAt: new Date().toISOString(),
    read: false,
    ...overrides,
  }
}

/** Probe exposing the notification count so preference gating is assertable. */
function FeedProbe({ onValue }: { onValue: (value: AppNotificationsContextValue) => void }) {
  const value = useAppNotifications()
  onValue(value)
  return <span data-testid="feed-count">{value.notifications.length}</span>
}

function renderScreen(
  notifications: AppNotification[] = [],
  onValue?: (value: AppNotificationsContextValue) => void,
) {
  return render(
    <AppNotificationsProvider initialNotifications={notifications}>
      <NotificationPreferencesScreen />
      <FeedProbe onValue={onValue ?? (() => {})} />
    </AppNotificationsProvider>,
  )
}

describe("NotificationPreferencesScreen", () => {
  beforeEach(() => {
    window.localStorage.clear()
    // The embedded communication-preferences panel loads
    // /api/communication-preferences on mount.
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          preferences: defaultCommunicationPreferences(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
  })

  it("renders the channel, category, and digest controls", () => {
    renderScreen()

    expect(screen.getByRole("heading", { name: "Notification preferences" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "In-app notifications" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Email notifications" })).not.toBeChecked()
    expect(screen.getByRole("switch", { name: "Pause all notifications" })).not.toBeChecked()
    expect(screen.getByRole("switch", { name: "Notification sounds" })).toBeChecked()
    expect(screen.getByLabelText("Sound tone")).toHaveValue("chime")
    expect(screen.getByRole("switch", { name: "Workspace activity in-app" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Agent runs email" })).toBeChecked()
    expect(screen.getByLabelText("Digest frequency")).toHaveValue("weekly")
    expect(screen.getByRole("link", { name: /Back to notifications/ })).toHaveAttribute(
      "href",
      "/dashboard/notifications",
    )
  })

  it("persists toggles to localStorage and gates in-app delivery", async () => {
    const user = userEvent.setup()
    let api: AppNotificationsContextValue | null = null
    renderScreen([buildNotification({ id: "seed" })], (value) => {
      api = value
    })

    await user.click(screen.getByRole("switch", { name: "Workspace activity in-app" }))

    const stored = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
    )
    expect(stored.categories.activity.inApp).toBe(false)

    act(() => {
      pushAppNotification({
        type: "info",
        title: "Muted category",
        body: "Should not appear",
        category: "activity",
      })
      pushAppNotification({
        type: "info",
        title: "Allowed category",
        body: "Should appear",
        category: "agent",
      })
      pushAppNotification({ type: "info", title: "Untagged", body: "Should appear" })
    })

    // Seed + agent + untagged; the activity notification is suppressed.
    expect(screen.getByTestId("feed-count")).toHaveTextContent("3")
    expect(api!.preferences.categories.activity.inApp).toBe(false)
  })

  it("mute pauses all in-app delivery until turned off", async () => {
    const user = userEvent.setup()
    renderScreen([])

    await user.click(screen.getByRole("switch", { name: "Pause all notifications" }))

    act(() => {
      pushAppNotification({ type: "info", title: "While muted", body: "Hidden" })
    })
    expect(screen.getByTestId("feed-count")).toHaveTextContent("0")

    await user.click(screen.getByRole("switch", { name: "Pause all notifications" }))

    act(() => {
      pushAppNotification({ type: "info", title: "After unmute", body: "Shown" })
    })
    expect(screen.getByTestId("feed-count")).toHaveTextContent("1")
  })

  it("restores persisted preferences after mount", () => {
    // Seed storage before render: the first client render must still match
    // the server (defaults), then the mount effect applies the stored blob.
    window.localStorage.setItem(
      NOTIFICATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        inApp: true,
        muted: false,
        email: true,
        digestFrequency: "daily",
        categories: { activity: { inApp: false, email: true } },
      }),
    )
    renderScreen()

    expect(screen.getByLabelText("Digest frequency")).toHaveValue("daily")
    // The stored blob predates sound preferences — defaults apply.
    expect(screen.getByRole("switch", { name: "Notification sounds" })).toBeChecked()
    expect(screen.getByLabelText("Sound tone")).toHaveValue("chime")
    expect(screen.getByRole("switch", { name: "Email notifications" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Workspace activity in-app" })).not.toBeChecked()
    // Categories missing from the stored blob fall back to defaults.
    expect(screen.getByRole("switch", { name: "Agent runs in-app" })).toBeChecked()
  })

  it("resets to defaults when another tab clears localStorage", async () => {
    const user = userEvent.setup()
    renderScreen([])

    await user.click(screen.getByRole("switch", { name: "Pause all notifications" }))
    expect(screen.getByRole("switch", { name: "Pause all notifications" })).toBeChecked()

    // `key: null` is what the storage event carries for localStorage.clear().
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }))
    })

    expect(screen.getByRole("switch", { name: "Pause all notifications" })).not.toBeChecked()
    expect(screen.getByLabelText("Digest frequency")).toHaveValue("weekly")
  })

  it("sound toggle and tone select persist to localStorage", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(screen.getByRole("switch", { name: "Notification sounds" }))
    expect(screen.getByLabelText("Sound tone")).toBeDisabled()

    await user.click(screen.getByRole("switch", { name: "Notification sounds" }))
    await user.selectOptions(screen.getByLabelText("Sound tone"), "bell")
    expect(screen.getByLabelText("Sound tone")).toHaveValue("bell")

    const stored = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
    )
    expect(stored.sound).toEqual({ enabled: true, tone: "bell" })
  })

  it("digest frequency and reset to defaults round-trip through storage", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.selectOptions(screen.getByLabelText("Digest frequency"), "daily")
    expect(screen.getByLabelText("Digest frequency")).toHaveValue("daily")

    await user.click(screen.getByRole("button", { name: /Reset to defaults/ }))

    expect(screen.getByLabelText("Digest frequency")).toHaveValue("weekly")
    expect(screen.getByRole("switch", { name: "In-app notifications" })).toBeChecked()

    const stored = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
    )
    expect(stored.digestFrequency).toBe("weekly")
  })

  it("embeds the account-level communication preferences panel", async () => {
    renderScreen()

    // Wait for a panel control — the section heading also renders while the
    // panel is still loading.
    expect(await screen.findByRole("switch", { name: "Referral program" })).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Email & product communications" }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Email digest frequency")).toHaveValue("weekly")
    // Account prefs are server-backed, not written to localStorage.
    const stored = window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)
    expect(stored ?? "{}").not.toContain("referralProgram")
  })

  it("creates a scheduled notification and lists it with a delete control", async () => {
    const user = userEvent.setup()
    window.localStorage.removeItem("spindle-notification-schedules")
    renderScreen()

    await user.type(screen.getByLabelText("Title"), "Water the plants")
    await user.selectOptions(screen.getByLabelText("Repeats"), "daily")
    await user.click(screen.getByRole("button", { name: /Schedule notification/ }))

    expect(await screen.findByText("Water the plants")).toBeInTheDocument()
    expect(screen.getByText(/Daily · at 09:00/)).toBeInTheDocument()

    const stored = JSON.parse(window.localStorage.getItem("spindle-notification-schedules") ?? "[]")
    expect(stored).toHaveLength(1)
    expect(stored[0].frequency).toBe("daily")

    await user.click(screen.getByRole("button", { name: /Delete schedule Water the plants/ }))
    expect(screen.queryByText("Water the plants")).not.toBeInTheDocument()
    window.localStorage.removeItem("spindle-notification-schedules")
  })

  it("offers a weekday picker for weekly schedules and stores it", async () => {
    const user = userEvent.setup()
    window.localStorage.removeItem("spindle-notification-schedules")
    renderScreen()

    await user.type(screen.getByLabelText("Title"), "Weekly report")
    await user.selectOptions(screen.getByLabelText("Repeats"), "weekly")

    const weekday = screen.getByLabelText("Day of week")
    await user.selectOptions(weekday, "5")
    await user.click(screen.getByRole("button", { name: /Schedule notification/ }))

    const stored = JSON.parse(window.localStorage.getItem("spindle-notification-schedules") ?? "[]")
    expect(stored).toHaveLength(1)
    expect(stored[0].frequency).toBe("weekly")
    expect(stored[0].weekday).toBe(5)
    // The summary line surfaces the chosen weekday.
    expect(await screen.findByText(/on Fri/)).toBeInTheDocument()
    window.localStorage.removeItem("spindle-notification-schedules")
  })

  it("sends a test notification from the selected template", async () => {
    const user = userEvent.setup()
    let api: AppNotificationsContextValue | null = null
    renderScreen([], (value) => {
      api = value
    })

    await user.selectOptions(screen.getByLabelText("Template"), "run-failed")
    expect(screen.getByText(/Run Nightly diff failed/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Send test notification/ }))

    expect(api!.notifications.some((n) => n.title.includes("Run Nightly diff failed"))).toBe(true)
    expect(api!.notifications.find((n) => n.title.includes("failed"))?.demo).toBe(true)
  })
})
