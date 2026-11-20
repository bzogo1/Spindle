import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { NotificationBell } from "./notification-bell"
import { AppNotificationsProvider, type AppNotification } from "./notifications-provider"

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

function renderBell(notifications: AppNotification[] = [buildNotification()]) {
  return render(
    <AppNotificationsProvider initialNotifications={notifications}>
      <NotificationBell />
    </AppNotificationsProvider>,
  )
}

describe("NotificationBell", () => {
  it("shows the unread badge and opens the notifications dropdown", async () => {
    renderBell([buildNotification({ title: "Unread item" })])

    const trigger = screen.getByRole("button", { name: "Notifications, 1 unread" })
    expect(trigger).toHaveTextContent("1")

    await userEvent.click(trigger)

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeInTheDocument()
    expect(screen.getByText("Unread item")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "View all notifications" })).toHaveAttribute(
      "href",
      "/dashboard/notifications",
    )
    expect(screen.getByRole("link", { name: /Preferences/ })).toHaveAttribute(
      "href",
      "/app/account/notifications",
    )
  })

  it("renders markdown in notification bodies inside the dropdown", async () => {
    renderBell([buildNotification({ title: "Deploy finished", body: "Run **passed** for `api`" })])

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }))

    expect(await screen.findByText("passed")).toBeInTheDocument()
    expect(document.querySelector(".app-notification-body code")).toHaveTextContent("api")
  })

  it("marks all notifications read from the dropdown", async () => {
    renderBell([buildNotification()])

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }))
    await userEvent.click(await screen.findByRole("button", { name: /Mark all read/ }))

    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Mark all read/ })).toBeDisabled()
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
  })

  it("marks a notification read and closes the dropdown when it is clicked", async () => {
    renderBell([buildNotification({ title: "Unread item" })])

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }))
    await userEvent.click(await screen.findByRole("button", { name: /Unread item/ }))

    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument()
    expect(screen.queryByText("Unread item")).not.toBeInTheDocument()
  })

  it("shows the caught-up state in the dropdown when empty", async () => {
    renderBell([])

    await userEvent.click(screen.getByRole("button", { name: "Notifications" }))

    expect((await screen.findAllByText("You're all caught up")).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /Mark all read/ })).toBeDisabled()
  })
})
