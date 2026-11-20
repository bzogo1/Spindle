import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotificationPermissionBanner } from "./notification-permission-banner"

type PermissionValue = "default" | "granted" | "denied"

class MockNotification {
  static permission: PermissionValue = "default"
  static requestPermission = vi.fn()
}

const originalNotification = window.Notification

function installNotification(permission: PermissionValue) {
  MockNotification.permission = permission
  MockNotification.requestPermission = vi.fn().mockResolvedValue(permission)
  // @ts-expect-error test double for the Notification API
  window.Notification = MockNotification
}

function uninstallNotification() {
  if (originalNotification === undefined) {
    // @ts-expect-error restore jsdom's missing API
    delete window.Notification
  } else {
    window.Notification = originalNotification
  }
}

afterEach(() => {
  uninstallNotification()
  vi.restoreAllMocks()
})

describe("NotificationPermissionBanner", () => {
  it("renders nothing when the API is unsupported", () => {
    uninstallNotification()
    const { container } = render(<NotificationPermissionBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing once permission is granted", async () => {
    installNotification("granted")
    const { container } = render(<NotificationPermissionBanner />)
    // The mount effect resolves "granted" — wait a tick for it to apply.
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("shows the enable prompt while permission is default and requests on click", async () => {
    const user = userEvent.setup()
    installNotification("default")
    MockNotification.requestPermission.mockResolvedValue("granted")
    render(<NotificationPermissionBanner />)

    expect(await screen.findByText("Get notified outside this tab")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Enable notifications" }))
    expect(MockNotification.requestPermission).toHaveBeenCalled()
  })

  it("shows blocked guidance with a re-check button while denied", async () => {
    const user = userEvent.setup()
    installNotification("denied")
    render(<NotificationPermissionBanner />)

    expect(await screen.findByText("Browser notifications are blocked")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Re-check permission" }))
    // Re-check re-reads state — still denied, guidance stays.
    expect(screen.getByText("Browser notifications are blocked")).toBeInTheDocument()
  })
})
