import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { KeyboardShortcuts } from "./keyboard-shortcuts"
import { FocusModeProvider } from "./focus-mode"

const navigationMocks = { push: vi.fn() }

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: navigationMocks.push }),
}))

function press(key: string, target: Element | Window = window) {
  fireEvent.keyDown(target, { key })
}

beforeEach(() => {
  navigationMocks.push.mockClear()
})

describe("KeyboardShortcuts", () => {
  it("navigates with g <key> sequences", () => {
    render(
      <FocusModeProvider>
        <KeyboardShortcuts />
      </FocusModeProvider>,
    )

    press("g")
    press("d")
    // Already on /dashboard: the router is not asked to push again.
    expect(navigationMocks.push).not.toHaveBeenCalled()

    press("g")
    press("p")
    expect(navigationMocks.push).toHaveBeenCalledWith("/projects")

    press("g")
    press("s")
    expect(navigationMocks.push).toHaveBeenCalledWith("/app/settings")
  })

  it("ignores the follow-up key after the goto window expires", () => {
    vi.useFakeTimers()
    try {
      render(
        <FocusModeProvider>
          <KeyboardShortcuts />
        </FocusModeProvider>,
      )
      press("g")
      vi.advanceTimersByTime(1500)
      press("p")
      expect(navigationMocks.push).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("opens the new-project flow with n", () => {
    const listener = vi.fn()
    window.addEventListener("spindle:open-new-project", listener)
    try {
      render(
        <FocusModeProvider>
          <KeyboardShortcuts />
        </FocusModeProvider>,
      )
      press("n")
      expect(listener).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem("spindle:open-new-project")).toBe("1")
      // Already on /dashboard, so no navigation is needed.
      expect(navigationMocks.push).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("spindle:open-new-project", listener)
      sessionStorage.removeItem("spindle:open-new-project")
    }
  })

  it("toggles the help overlay with ?", async () => {
    render(
      <FocusModeProvider>
        <KeyboardShortcuts />
      </FocusModeProvider>,
    )

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    press("?")
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument()

    press("?")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("does not fire while typing in form fields", () => {
    render(
      <FocusModeProvider>
        <KeyboardShortcuts />
        <input aria-label="field" />
      </FocusModeProvider>,
    )
    const input = screen.getByLabelText("field")

    press("g", input)
    press("p", input)
    press("n", input)
    press("?", input)

    expect(navigationMocks.push).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(sessionStorage.getItem("spindle:open-new-project")).toBeNull()
  })

  it("does not fire while a modal overlay is open", () => {
    render(
      <FocusModeProvider>
        <KeyboardShortcuts />
        <div role="dialog" aria-label="other overlay" />
      </FocusModeProvider>,
    )

    press("g")
    press("p")
    press("n")

    expect(navigationMocks.push).not.toHaveBeenCalled()
    expect(sessionStorage.getItem("spindle:open-new-project")).toBeNull()
    sessionStorage.removeItem("spindle:open-new-project")
  })

  it("ignores chords with modifier keys", () => {
    render(
      <FocusModeProvider>
        <KeyboardShortcuts />
      </FocusModeProvider>,
    )
    fireEvent.keyDown(window, { key: "g", ctrlKey: true })
    fireEvent.keyDown(window, { key: "p" })
    expect(navigationMocks.push).not.toHaveBeenCalled()
  })
})
