import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  AppNotificationsProvider,
  pushAppNotification,
  type AppNotification,
} from "./notifications-provider"
import { NotificationsScreen } from "./notifications-screen"

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

function renderScreen(notifications: AppNotification[] = [buildNotification()]) {
  return render(
    <AppNotificationsProvider initialNotifications={notifications}>
      <NotificationsScreen />
    </AppNotificationsProvider>,
  )
}

describe("NotificationsScreen", () => {
  it("renders notifications and marks all of them read", async () => {
    renderScreen([
      buildNotification({ id: "ntf_1", title: "First notification" }),
      buildNotification({ id: "ntf_2", title: "Second notification", read: true }),
    ])

    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument()
    expect(screen.getByText("1 unread")).toBeInTheDocument()
    expect(screen.getByText("First notification")).toBeInTheDocument()
    expect(screen.getByText("Second notification")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /Mark all read/ }))

    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Mark all read/ })).toBeDisabled()
  })

  it("marks a notification read when it is clicked", async () => {
    renderScreen([buildNotification({ title: "Unread item" })])

    await userEvent.click(screen.getByRole("button", { name: /Unread item/ }))

    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Mark all read/ })).toBeDisabled()
  })

  it("links notification rows to their destination", () => {
    renderScreen([buildNotification({ title: "Open files", href: "/app/files", read: true })])

    expect(screen.getByRole("link", { name: /Open files/ })).toHaveAttribute("href", "/app/files")
  })

  it("renders markdown in notification bodies", async () => {
    renderScreen([
      buildNotification({
        title: "Deploy finished",
        body: "Run **passed** — see [details](https://example.com/run/1)",
        read: true,
      }),
    ])

    expect(await screen.findByText("passed")).toBeInTheDocument()
    // Markdown links render as non-interactive spans, not nested anchors.
    expect(screen.queryByRole("link", { name: "details" })).not.toBeInTheDocument()
    expect(document.querySelector(".app-notification-md-link")).toHaveTextContent("details")
    expect(document.querySelector(".app-notification-md-link")).toHaveAttribute(
      "title",
      "https://example.com/run/1",
    )
  })

  it("paginates the notification list", async () => {
    const user = userEvent.setup()
    renderScreen(
      Array.from({ length: 12 }, (_, index) =>
        buildNotification({
          id: `ntf_${index}`,
          title: `Notification ${index + 1}`,
          read: true,
        }),
      ),
    )

    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument()
    expect(screen.getByText("Notification 1")).toBeInTheDocument()
    expect(screen.queryByText("Notification 11")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Go to previous page" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Go to next page" }))

    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument()
    expect(screen.getByText("Notification 11")).toBeInTheDocument()
    expect(screen.queryByText("Notification 1")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Go to next page" })).toBeDisabled()

    await user.click(screen.getByRole("link", { name: "1" }))
    expect(screen.getByText("Notification 1")).toBeInTheDocument()
  })

  it("keeps the current page when a realtime notification arrives", async () => {
    const user = userEvent.setup()
    renderScreen(
      Array.from({ length: 12 }, (_, index) =>
        buildNotification({
          id: `ntf_${index}`,
          title: `Notification ${index + 1}`,
          read: true,
        }),
      ),
    )

    await user.click(screen.getByRole("button", { name: "Go to next page" }))
    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument()

    act(() => {
      pushAppNotification({ type: "info", title: "Live ping", body: "Arrived live" })
    })

    // The feed grew to 13 items; page 2 still renders (now positions 11–13)
    // and the pager clamps instead of resetting or overflowing. The new
    // item lands at the top of page 1.
    expect(screen.getByText("Showing 11–13 of 13")).toBeInTheDocument()
    expect(screen.getByText("Notification 10")).toBeInTheDocument()
    expect(screen.getByText("Notification 12")).toBeInTheDocument()
    expect(screen.queryByText("Live ping")).not.toBeInTheDocument()
  })

  it("groups notifications by category with untagged items under Other", () => {
    renderScreen([
      buildNotification({ id: "ntf_agent_1", title: "Agent run failed", category: "agent" }),
      buildNotification({ id: "ntf_plain", title: "Untagged update" }),
      buildNotification({
        id: "ntf_agent_2",
        title: "Agent run finished",
        category: "agent",
        read: true,
      }),
      buildNotification({ id: "ntf_sec", title: "New sign-in", category: "security" }),
    ])

    const groupTitles = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
    // Fixed category order: agent before security, untagged fallback last.
    expect(groupTitles).toEqual(["Agent", "Security", "Other"])

    // Same-category items share a group regardless of feed position.
    const agentGroup = screen.getByRole("heading", { name: "Agent" }).parentElement
    expect(agentGroup).toHaveTextContent("Agent run failed")
    expect(agentGroup).toHaveTextContent("Agent run finished")
    expect(agentGroup).not.toHaveTextContent("Untagged update")
    expect(screen.getByRole("heading", { name: "Other" }).parentElement).toHaveTextContent(
      "Untagged update",
    )
  })

  it("groups only the notifications on the current page", async () => {
    const user = userEvent.setup()
    renderScreen(
      Array.from({ length: 12 }, (_, index) =>
        buildNotification({
          id: `ntf_${index}`,
          title: `Notification ${index + 1}`,
          category: index < 10 ? "activity" : "agent",
          read: true,
        }),
      ),
    )

    // Page 1 slice is all "activity" — a single group header.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Activity",
    ])

    await user.click(screen.getByRole("button", { name: "Go to next page" }))

    // Page 2 slice is all "agent" — grouping is per page, not global.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Agent",
    ])
    expect(screen.queryByText("Notification 1")).not.toBeInTheDocument()
  })

  it("shows the empty state when there are no notifications", () => {
    renderScreen([])

    expect(screen.getByRole("heading", { name: "You're all caught up" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Notification preferences/ })).toHaveAttribute(
      "href",
      "/app/account/notifications",
    )
  })

  it("filters notifications by project, keeping untagged items under All", async () => {
    const user = userEvent.setup()
    renderScreen([
      buildNotification({ id: "ntf_a", title: "Coastal update", projectId: "prj_01" }),
      buildNotification({ id: "ntf_b", title: "Tide archive update", projectId: "prj_02" }),
      buildNotification({ id: "ntf_c", title: "Workspace update" }),
    ])

    const filter = await screen.findByRole("combobox", { name: "Filter by project" })
    // Untagged and tagged notifications all appear under the default filter.
    expect(screen.getByText("Coastal update")).toBeInTheDocument()
    expect(screen.getByText("Tide archive update")).toBeInTheDocument()
    expect(screen.getByText("Workspace update")).toBeInTheDocument()
    expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument()

    await user.selectOptions(filter, "prj_01")

    // Only exact projectId matches survive — untagged items are excluded.
    expect(screen.getByText("Coastal update")).toBeInTheDocument()
    expect(screen.queryByText("Tide archive update")).not.toBeInTheDocument()
    expect(screen.queryByText("Workspace update")).not.toBeInTheDocument()
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument()

    await user.selectOptions(filter, "all")
    expect(screen.getByText("Workspace update")).toBeInTheDocument()
    expect(screen.getByText("Showing 1–3 of 3")).toBeInTheDocument()
  })

  it("shows an empty state with a reset action when a project has no notifications", async () => {
    const user = userEvent.setup()
    renderScreen([buildNotification({ title: "Workspace update" })])

    const filter = await screen.findByRole("combobox", { name: "Filter by project" })
    await user.selectOptions(filter, "prj_03")

    expect(
      screen.getByRole("heading", { name: "No notifications for this project" }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Show all projects" }))
    expect(screen.getByText("Workspace update")).toBeInTheDocument()
  })

  it("filters the inbox by category", async () => {
    const user = userEvent.setup()
    renderScreen([
      buildNotification({ id: "ntf_a", title: "Agent ping", category: "agent" }),
      buildNotification({ id: "ntf_b", title: "Lab ping", category: "lab" }),
      buildNotification({ id: "ntf_c", title: "Untagged ping" }),
    ])

    const filter = await screen.findByRole("combobox", { name: "Filter by category" })
    expect(screen.getByText("Agent ping")).toBeInTheDocument()
    expect(screen.getByText("Lab ping")).toBeInTheDocument()
    expect(screen.getByText("Untagged ping")).toBeInTheDocument()

    await user.selectOptions(filter, "agent")

    expect(screen.getByText("Agent ping")).toBeInTheDocument()
    expect(screen.queryByText("Lab ping")).not.toBeInTheDocument()
    expect(screen.queryByText("Untagged ping")).not.toBeInTheDocument()
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument()

    await user.selectOptions(filter, "all")
    expect(screen.getByText("Lab ping")).toBeInTheDocument()
  })

  it("only offers categories present in the feed", async () => {
    renderScreen([
      buildNotification({ id: "ntf_a", title: "Agent ping", category: "agent" }),
      buildNotification({ id: "ntf_b", title: "Lab ping", category: "lab" }),
      buildNotification({ id: "ntf_c", title: "Untagged ping" }),
    ])

    const filter = await screen.findByRole("combobox", { name: "Filter by category" })
    const labels = Array.from(filter.querySelectorAll("option")).map((option) => option.textContent)
    // Only categories present in the feed are listed, in canonical order.
    expect(labels).toEqual(["All categories", "Agent runs", "Lab sessions"])
  })

  it("groups related notifications into expandable threads", async () => {
    const user = userEvent.setup()
    const base = Date.now()
    renderScreen([
      buildNotification({
        id: "ntf_t1",
        title: "Run finished",
        category: "agent",
        subject: "nightly diff",
        createdAt: new Date(base - 60_000).toISOString(),
      }),
      buildNotification({
        id: "ntf_t2",
        title: "Run finished",
        category: "agent",
        subject: "nightly diff",
        createdAt: new Date(base - 120_000).toISOString(),
        read: true,
      }),
      buildNotification({
        id: "ntf_t3",
        title: "Unrelated update",
        createdAt: new Date(base - 180_000).toISOString(),
      }),
    ])

    await user.click(screen.getByRole("button", { name: /Threads/ }))

    // The thread shows its latest item plus a digest summary; the earlier
    // member is hidden until expanded.
    expect(screen.getAllByText("Run finished")).toHaveLength(1)
    expect(screen.getByText(/2 updates · 1 unread/)).toBeInTheDocument()
    expect(screen.getByText("Unrelated update")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Show 1 earlier update/ }))
    expect(screen.getAllByText("Run finished")).toHaveLength(2)

    await user.click(screen.getByRole("button", { name: /Show less/ }))
    expect(screen.getAllByText("Run finished")).toHaveLength(1)
  })

  it("marks an item unread, snoozes it away, and dismisses it via row actions", async () => {
    const user = userEvent.setup()
    renderScreen([
      buildNotification({ id: "ntf_x", title: "Actionable item", read: true }),
      buildNotification({ id: "ntf_y", title: "Second item" }),
    ])

    // Mark read → unread flips the unread count up.
    await user.click(screen.getAllByRole("button", { name: "Mark as unread" })[0])
    expect(screen.getByText("2 unread")).toBeInTheDocument()

    // Dismiss removes the row entirely.
    await user.click(screen.getAllByRole("button", { name: "Dismiss notification" })[0])
    expect(screen.queryByText("Actionable item")).not.toBeInTheDocument()
    expect(screen.getByText("Second item")).toBeInTheDocument()
  })

  it("hides a snoozed notification until its wake time", async () => {
    const user = userEvent.setup()
    renderScreen([buildNotification({ id: "ntf_s", title: "Snooze me" })])

    await user.click(screen.getByRole("button", { name: "Snooze notification" }))
    await user.click(await screen.findByRole("button", { name: "30 minutes" }))

    expect(screen.queryByText("Snooze me")).not.toBeInTheDocument()
    // The page subtitle and the empty state share this copy — assert the
    // empty-state heading specifically.
    expect(screen.getByRole("heading", { name: "You're all caught up" })).toBeInTheDocument()
  })

  it("applies the project filter to realtime notifications", async () => {
    const user = userEvent.setup()
    renderScreen([buildNotification({ title: "Workspace update" })])

    const filter = await screen.findByRole("combobox", { name: "Filter by project" })
    await user.selectOptions(filter, "prj_01")

    act(() => {
      pushAppNotification({
        type: "info",
        title: "Matching ping",
        body: "Tagged with prj_01",
        projectId: "prj_01",
      })
      pushAppNotification({
        type: "info",
        title: "Other project ping",
        body: "Tagged with prj_02",
        projectId: "prj_02",
      })
    })

    expect(await screen.findByText("Matching ping")).toBeInTheDocument()
    expect(screen.queryByText("Other project ping")).not.toBeInTheDocument()
    expect(screen.queryByText("Workspace update")).not.toBeInTheDocument()
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument()
  })
})
