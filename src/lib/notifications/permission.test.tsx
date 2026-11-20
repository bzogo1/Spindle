import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getNotificationPermissionState,
  requestNotificationPermission,
  showSystemNotification,
  useNotificationPermission,
} from "./permission"

type PermissionValue = "default" | "granted" | "denied"

class MockNotification {
  static permission: PermissionValue = "default"
  static requestPermission = vi.fn()
  static instances: MockNotification[] = []

  readonly title: string
  readonly options?: NotificationOptions
  onclick: (() => void) | null = null

  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options
    MockNotification.instances.push(this)
  }
}

const originalNotification = window.Notification

function installNotification(permission: PermissionValue = "default") {
  MockNotification.permission = permission
  MockNotification.instances = []
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

describe("getNotificationPermissionState", () => {
  it("reports unsupported when the API is missing", () => {
    uninstallNotification()
    expect(getNotificationPermissionState()).toBe("unsupported")
  })

  it("maps the browser permission value", () => {
    installNotification("granted")
    expect(getNotificationPermissionState()).toBe("granted")
    installNotification("denied")
    expect(getNotificationPermissionState()).toBe("denied")
    installNotification("default")
    expect(getNotificationPermissionState()).toBe("default")
  })
})

describe("requestNotificationPermission", () => {
  it("resolves with the granted state after the user allows", async () => {
    installNotification("default")
    MockNotification.requestPermission.mockResolvedValue("granted")

    await expect(requestNotificationPermission()).resolves.toBe("granted")
    expect(MockNotification.requestPermission).toHaveBeenCalled()
  })

  it("is a no-op returning current state when unsupported", async () => {
    uninstallNotification()
    await expect(requestNotificationPermission()).resolves.toBe("unsupported")
  })
})

describe("showSystemNotification", () => {
  it("creates a Notification only when permission is granted", () => {
    installNotification("default")
    expect(showSystemNotification({ title: "Hi", body: "There" })).toBe(false)
    expect(MockNotification.instances).toHaveLength(0)

    installNotification("granted")
    expect(showSystemNotification({ title: "Hi", body: "There", tag: "t1" })).toBe(true)
    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].title).toBe("Hi")
    expect(MockNotification.instances[0].options?.body).toBe("There")
    expect(MockNotification.instances[0].options?.tag).toBe("t1")
  })

  it("focuses the window on click", () => {
    installNotification("granted")
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {})
    showSystemNotification({ title: "Run done", href: "/app/agent/run_1" })
    const notification = MockNotification.instances[0]
    // jsdom cannot navigate — the "Not implemented" notice is expected; the
    // assertion is that focus() ran and onclick did not throw.
    expect(() => notification.onclick?.()).not.toThrow()
    expect(focus).toHaveBeenCalled()
  })

  it("returns false when construction throws", () => {
    installNotification("granted")
    // @ts-expect-error force constructor failure
    window.Notification = class {
      static permission = "granted"
      constructor() {
        throw new Error("blocked")
      }
    }
    expect(showSystemNotification({ title: "x" })).toBe(false)
  })
})

function PermissionProbe() {
  const permission = useNotificationPermission()
  return (
    <div>
      <span data-testid="state">{permission.state}</span>
      <span data-testid="supported">{String(permission.supported)}</span>
      <button type="button" onClick={() => void permission.request()}>
        Request
      </button>
      <button type="button" onClick={permission.refresh}>
        Refresh
      </button>
    </div>
  )
}

describe("useNotificationPermission", () => {
  it("starts unsupported then resolves the real state on mount", async () => {
    installNotification("granted")
    render(<PermissionProbe />)
    expect(await screen.findByTestId("state")).toHaveTextContent("granted")
    expect(screen.getByTestId("supported")).toHaveTextContent("true")
  })

  it("re-checks permission on window focus", async () => {
    installNotification("denied")
    render(<PermissionProbe />)
    expect(await screen.findByTestId("state")).toHaveTextContent("denied")

    // The user flips the setting in browser UI; focus re-reads it.
    MockNotification.permission = "granted"
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(screen.getByTestId("state")).toHaveTextContent("granted")
  })

  it("re-checks permission on visibilitychange", async () => {
    installNotification("default")
    render(<PermissionProbe />)
    expect(await screen.findByTestId("state")).toHaveTextContent("default")

    MockNotification.permission = "denied"
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(screen.getByTestId("state")).toHaveTextContent("denied")
  })

  it("request() updates state with the result", async () => {
    const user = userEvent.setup()
    installNotification("default")
    MockNotification.requestPermission.mockResolvedValue("granted")
    render(<PermissionProbe />)
    await screen.findByTestId("state")

    await user.click(screen.getByRole("button", { name: "Request" }))
    expect(await screen.findByTestId("state")).toHaveTextContent("granted")
  })
})
