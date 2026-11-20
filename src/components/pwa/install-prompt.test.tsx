import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env", () => ({
  clientEnv: { NODE_ENV: "production" },
}))

import { InstallPrompt } from "./install-prompt"

const DISMISS_KEY = "spindle-pwa-install-dismissed-at"
const INSTALLED_KEY = "spindle-pwa-installed"
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

interface FakeInstallEvent extends Event {
  prompt: ReturnType<typeof vi.fn>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function fireBeforeInstallPrompt(): FakeInstallEvent {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as FakeInstallEvent
  event.prompt = vi.fn(async () => {})
  event.userChoice = Promise.resolve({ outcome: "accepted" })
  window.dispatchEvent(event)
  return event
}

let originalUserAgent: string
let originalPlatform: string

beforeEach(() => {
  window.localStorage.clear()
  originalUserAgent = navigator.userAgent
  originalPlatform = navigator.platform
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, "userAgent", {
    value: originalUserAgent,
    configurable: true,
  })
  Object.defineProperty(navigator, "platform", {
    value: originalPlatform,
    configurable: true,
  })
})

describe("InstallPrompt", () => {
  it("renders nothing until beforeinstallprompt fires", () => {
    render(<InstallPrompt />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("captures beforeinstallprompt, prevents default and shows the banner", async () => {
    render(<InstallPrompt />)
    const event = fireBeforeInstallPrompt()

    expect(event.defaultPrevented).toBe(true)
    expect(await screen.findByRole("dialog", { name: "Install Spindle" })).toBeInTheDocument()
  })

  it("hands the deferred prompt to the browser on Install and hides", async () => {
    render(<InstallPrompt />)
    const event = fireBeforeInstallPrompt()
    await screen.findByRole("dialog")

    fireEvent.click(screen.getByRole("button", { name: "Install" }))

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("dismiss snoozes the banner for seven days, even across repeat prompts", async () => {
    const first = render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    await screen.findByRole("dialog")

    fireEvent.click(screen.getByRole("button", { name: "Not now" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(window.localStorage.getItem(DISMISS_KEY)).not.toBeNull()
    first.unmount()

    // A second beforeinstallprompt inside the snooze window must not re-show it.
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
  })

  it("shows again once the snooze window has passed", async () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() - 8 * 24 * 60 * 60 * 1000))
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("hides permanently when the app is installed", async () => {
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    await screen.findByRole("dialog")

    window.dispatchEvent(new Event("appinstalled"))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows a welcome toast after appinstalled and records the install", async () => {
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    await screen.findByRole("dialog")

    window.dispatchEvent(new Event("appinstalled"))

    expect(await screen.findByRole("status")).toHaveTextContent(/Welcome to Spindle/i)
    expect(window.localStorage.getItem(INSTALLED_KEY)).toBe("1")

    // The welcome toast can be dismissed manually.
    fireEvent.click(screen.getByRole("button", { name: "Got it" }))
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
  })

  it("auto-hides the welcome toast after the timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<InstallPrompt />)
    window.dispatchEvent(new Event("appinstalled"))

    expect(await screen.findByRole("status")).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100)
    })
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("never shows install UI when the installed flag is already set", async () => {
    window.localStorage.setItem(INSTALLED_KEY, "1")
    render(<InstallPrompt />)
    fireBeforeInstallPrompt()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })
})

describe("InstallPrompt iOS Safari fallback", () => {
  function stubIosSafari() {
    Object.defineProperty(navigator, "userAgent", {
      value: IOS_SAFARI_UA,
      configurable: true,
    })
    Object.defineProperty(navigator, "platform", {
      value: "iPhone",
      configurable: true,
    })
  }

  it("shows manual install instructions on iOS Safari after the grace period", async () => {
    vi.useFakeTimers()
    stubIosSafari()
    render(<InstallPrompt />)

    // Nothing before the fallback delay.
    expect(screen.queryByRole("dialog")).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    // Synchronous query: findBy* polls on timers, which are fake here.
    const dialog = screen.getByRole("dialog", { name: "Install Spindle" })
    expect(dialog).toHaveTextContent(/Add to Home Screen/i)
  })

  it("does not show iOS instructions when beforeinstallprompt fires first", async () => {
    vi.useFakeTimers()
    stubIosSafari()
    render(<InstallPrompt />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
      fireBeforeInstallPrompt()
      await vi.advanceTimersByTimeAsync(2000)
    })

    // Native path won; still exactly one dialog and it has the Install button.
    const dialogs = screen.getAllByRole("dialog")
    expect(dialogs).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument()
  })

  it("skips iOS instructions on non-Safari iOS browsers", async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, "userAgent", {
      value: IOS_SAFARI_UA.replace("Safari/604.1", "CriOS/120.0 Mobile/15E148 Safari/604.1"),
      configurable: true,
    })
    Object.defineProperty(navigator, "platform", {
      value: "iPhone",
      configurable: true,
    })
    render(<InstallPrompt />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("respects the dismissal snooze on the iOS path too", async () => {
    vi.useFakeTimers()
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    stubIosSafari()
    render(<InstallPrompt />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
