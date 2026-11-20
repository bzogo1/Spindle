import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { AppNotification } from "./notifications-provider"
import { NotificationItem } from "./notification-item"

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

describe("NotificationItem", () => {
  it("prefixes unread notifications with a screen-reader label and dot", () => {
    const { container } = render(
      <NotificationItem
        notification={buildNotification({ title: "Unread item", read: false })}
        onRead={vi.fn()}
      />,
    )

    expect(screen.getByText("Unread:", { exact: false })).toHaveClass("sr-only")
    expect(container.querySelector(".app-notification-unread-dot")).not.toBeNull()
    expect(screen.getByRole("button", { name: /Unread:/ })).toBeInTheDocument()
  })

  it("omits the unread prefix and dot for read notifications", () => {
    const { container } = render(
      <NotificationItem
        notification={buildNotification({ title: "Read item", read: true })}
        onRead={vi.fn()}
      />,
    )

    expect(screen.queryByText("Unread:", { exact: false })).not.toBeInTheDocument()
    expect(container.querySelector(".app-notification-unread-dot")).toBeNull()
    expect(screen.getByRole("button", { name: /Read item/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Unread/ })).not.toBeInTheDocument()
  })

  it("renders a link when the notification has an href and marks it read on click", async () => {
    const onRead = vi.fn()

    render(
      <NotificationItem
        notification={buildNotification({
          id: "ntf_link",
          title: "Open files",
          href: "/projects/prj_01/files",
        })}
        onRead={onRead}
      />,
    )

    const link = screen.getByRole("link", { name: /Open files/ })
    expect(link).toHaveAttribute("href", "/projects/prj_01/files")
    expect(link).toHaveClass("is-unread")

    await userEvent.click(link)
    expect(onRead).toHaveBeenCalledWith("ntf_link")
  })

  it("renders a button without an href and marks it read on click", async () => {
    const onRead = vi.fn()

    render(
      <NotificationItem
        notification={buildNotification({ id: "ntf_button", title: "Heads up" })}
        onRead={onRead}
      />,
    )

    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    const button = screen.getByRole("button", { name: /Heads up/ })
    expect(button).toHaveClass("is-unread")

    await userEvent.click(button)
    expect(onRead).toHaveBeenCalledWith("ntf_button")
  })

  it("shows a (demo) marker only for demo notifications", () => {
    render(
      <ul>
        <li>
          <NotificationItem
            notification={buildNotification({ id: "ntf_demo", title: "Demo item", demo: true })}
            onRead={vi.fn()}
          />
        </li>
        <li>
          <NotificationItem
            notification={buildNotification({ id: "ntf_real", title: "Real item" })}
            onRead={vi.fn()}
          />
        </li>
      </ul>,
    )

    expect(screen.getByText("(demo)")).toBeInTheDocument()
    expect(screen.getAllByText("(demo)")).toHaveLength(1)
  })

  it("renders markdown formatting in the notification body", async () => {
    render(
      <NotificationItem
        notification={buildNotification({
          body: "Deploy **succeeded** for `api` — see [logs](https://example.com/logs)",
        })}
        onRead={vi.fn()}
      />,
    )

    const body = document.querySelector(".app-notification-body")
    expect(await screen.findByText("succeeded")).toBeInTheDocument()
    expect(body?.querySelector("strong")).toHaveTextContent("succeeded")
    expect(body?.querySelector("code")).toHaveTextContent("api")
    // Markdown links render as non-interactive spans — the row itself is the
    // clickable element, so a nested <a> would be invalid.
    expect(screen.queryByRole("link", { name: "logs" })).not.toBeInTheDocument()
    const mdLink = body?.querySelector(".app-notification-md-link")
    expect(mdLink).toHaveTextContent("logs")
    expect(mdLink).toHaveAttribute("title", "https://example.com/logs")
  })

  it("does not emit a nested anchor inside a linked notification", async () => {
    const { container } = render(
      <NotificationItem
        notification={buildNotification({
          title: "Open run",
          href: "/app/runs/run_1",
          body: "See [details](https://example.com/run)",
        })}
        onRead={vi.fn()}
      />,
    )

    await screen.findByText("details")

    // Exactly one anchor: the row link itself. The markdown link is a span.
    const anchors = container.querySelectorAll("a")
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toHaveAttribute("href", "/app/runs/run_1")
    expect(container.querySelector(".app-notification-body a")).toBeNull()
    expect(container.querySelector(".app-notification-md-link")).toHaveTextContent("details")
  })

  it("renders markdown lists in the notification body", async () => {
    render(
      <NotificationItem
        notification={buildNotification({ body: "Changed files:\n- `src/a.ts`\n- `src/b.ts`" })}
        onRead={vi.fn()}
      />,
    )

    const items = await screen.findAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("src/a.ts")
    expect(items[1]).toHaveTextContent("src/b.ts")
  })

  it("does not render raw HTML from the notification body", async () => {
    const { container } = render(
      <NotificationItem
        notification={buildNotification({ body: "Hello <img src=x onerror=alert(1)>" })}
        onRead={vi.fn()}
      />,
    )

    await screen.findByText(/Hello/)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector(".app-notification-body")?.innerHTML).not.toContain("<img")
  })

  it("does not include the is-unread class for read notifications", () => {
    render(
      <NotificationItem
        notification={buildNotification({ title: "Done", read: true })}
        onRead={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: /Done/ })).not.toHaveClass("is-unread")
  })

  it("renders no action controls when no handlers are provided", () => {
    render(
      <NotificationItem
        notification={buildNotification({ title: "Plain", actions: [{ id: "a", label: "Go" }] })}
        onRead={vi.fn()}
      />,
    )

    expect(screen.queryByRole("button", { name: "Snooze notification" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Dismiss notification" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument()
  })

  it("toggles read state, dismisses, and snoozes via the action controls", async () => {
    const user = userEvent.setup()
    const onToggleRead = vi.fn()
    const onDismiss = vi.fn()
    const onSnooze = vi.fn()

    render(
      <NotificationItem
        notification={buildNotification({ id: "ntf_ctl", title: "Controlled" })}
        onRead={vi.fn()}
        onToggleRead={onToggleRead}
        onDismiss={onDismiss}
        onSnooze={onSnooze}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Mark as read" }))
    expect(onToggleRead).toHaveBeenCalledWith("ntf_ctl")

    await user.click(screen.getByRole("button", { name: "Dismiss notification" }))
    expect(onDismiss).toHaveBeenCalledWith("ntf_ctl")

    // Snooze opens a preset menu; picking "1 hour" reports an ISO instant.
    await user.click(screen.getByRole("button", { name: "Snooze notification" }))
    await user.click(await screen.findByRole("button", { name: "1 hour" }))
    expect(onSnooze).toHaveBeenCalledWith("ntf_ctl", expect.any(String))
    expect(Date.parse(onSnooze.mock.calls[0][1])).toBeGreaterThan(Date.now())
  })

  it("labels the read toggle correctly for read notifications", () => {
    render(
      <NotificationItem
        notification={buildNotification({ title: "Read item", read: true })}
        onRead={vi.fn()}
        onToggleRead={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Mark as unread" })).toBeInTheDocument()
  })

  it("renders producer-declared actions and routes them through onAction", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const notification = buildNotification({
      title: "Run finished",
      actions: [
        { id: "view", label: "View run", href: "/app/agent/run_1" },
        { id: "later", label: "Remind me", snoozeMinutes: 30 },
      ],
    })

    render(<NotificationItem notification={notification} onRead={vi.fn()} onAction={onAction} />)

    const viewRun = screen.getByRole("link", { name: "View run" })
    expect(viewRun).toHaveAttribute("href", "/app/agent/run_1")
    await user.click(viewRun)
    expect(onAction).toHaveBeenCalledWith(notification, notification.actions?.[0])

    await user.click(screen.getByRole("button", { name: "Remind me" }))
    expect(onAction).toHaveBeenCalledWith(notification, notification.actions?.[1])
  })
})
