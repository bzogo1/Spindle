import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  isTutorialCompleted,
  markTutorialCompleted,
  resetTutorialCompletion,
  tutorialStorageKey,
} from "./completion"
import { TutorialRunner } from "./tutorial-engine"
import type { Tutorial } from "./types"

const tutorial: Tutorial = {
  id: "test-tour",
  title: "Test tour",
  steps: [
    { id: "s1", title: "First step", content: "Hello one" },
    {
      id: "s2",
      target: "#spot-target",
      title: "Second step",
      content: "Hello two",
    },
    { id: "s3", title: "Third step", content: "Hello three" },
  ],
}

function renderRunner(overrides: Partial<Parameters<typeof TutorialRunner>[0]> = {}) {
  const onClose = vi.fn()
  const onComplete = vi.fn()
  render(
    <div>
      <div id="spot-target">target</div>
      <TutorialRunner
        tutorial={tutorial}
        open
        onClose={onClose}
        onComplete={onComplete}
        {...overrides}
      />
    </div>,
  )
  return { onClose, onComplete }
}

describe("tutorial completion storage", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("round-trips completion state per tutorial id", () => {
    expect(isTutorialCompleted("a")).toBe(false)
    markTutorialCompleted("a")
    expect(isTutorialCompleted("a")).toBe(true)
    expect(isTutorialCompleted("b")).toBe(false)
    expect(window.localStorage.getItem(tutorialStorageKey("a"))).toBe("1")

    resetTutorialCompletion("a")
    expect(isTutorialCompleted("a")).toBe(false)
  })
})

describe("TutorialRunner", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders nothing when closed", () => {
    render(<TutorialRunner tutorial={tutorial} open={false} onClose={() => {}} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows the first step with progress and walks forward/back", async () => {
    const user = userEvent.setup()
    renderRunner()

    expect(screen.getByRole("dialog", { name: "Test tour" })).toBeInTheDocument()
    expect(screen.getByText("First step")).toBeInTheDocument()
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Second step")).toBeInTheDocument()
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument()
    expect(screen.getByText("Hello two")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByText("First step")).toBeInTheDocument()
  })

  it("marks the tutorial completed and closes on the last step", async () => {
    const user = userEvent.setup()
    const { onClose, onComplete } = renderRunner()

    await user.click(screen.getByRole("button", { name: "Next" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(onComplete).toHaveBeenCalledWith("test-tour")
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(isTutorialCompleted("test-tour")).toBe(true)
  })

  it("skips via the Skip button and Escape without completing", async () => {
    const user = userEvent.setup()
    const { onClose } = renderRunner()

    await user.click(screen.getByRole("button", { name: "Skip tutorial" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(isTutorialCompleted("test-tour")).toBe(false)
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    const { onClose } = renderRunner()

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("moves focus into the dialog and traps Tab inside it", async () => {
    const user = userEvent.setup()
    renderRunner()

    const dialog = screen.getByRole("dialog", { name: "Test tour" })
    // Focus lands inside the dialog on open (the runner focuses its content).
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Tab cycles only through the dialog's controls — focus never escapes
    // to the page behind the overlay.
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it("restores focus to the previously focused element on close", async () => {
    const user = userEvent.setup()
    const outside = document.createElement("button")
    outside.textContent = "outside"
    document.body.appendChild(outside)
    outside.focus()
    expect(outside).toHaveFocus()

    const { rerender } = render(<TutorialRunner tutorial={tutorial} open onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: "Test tour" })
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.click(screen.getByRole("button", { name: "Skip tutorial" }))
    // Simulate the parent honoring onClose by flipping open off.
    rerender(<TutorialRunner tutorial={tutorial} open={false} onClose={() => {}} />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Radix restores focus asynchronously after the dialog unmounts.
    await waitFor(() => expect(outside).toHaveFocus())
    outside.remove()
  })

  it("announces step changes via an aria-live region", () => {
    renderRunner()
    const liveRegion = document.querySelector(".tutorial-step-body")
    expect(liveRegion).not.toBeNull()
    expect(liveRegion).toHaveAttribute("aria-live", "polite")
  })

  it("resets to the first step when reopened", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TutorialRunner tutorial={tutorial} open onClose={() => {}} />)
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument()

    rerender(<TutorialRunner tutorial={tutorial} open={false} onClose={() => {}} />)
    rerender(<TutorialRunner tutorial={tutorial} open onClose={() => {}} />)
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument()
  })
})
