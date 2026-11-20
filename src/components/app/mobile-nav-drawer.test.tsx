import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { MobileNavDrawer } from "@/components/app/mobile-nav-drawer"

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <MobileNavDrawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      trigger={<button type="button">Open nav</button>}
    >
      <nav aria-label="Test nav">
        <a href="/dashboard">Dashboard</a>
      </nav>
    </MobileNavDrawer>
  )
}

function swipe(
  target: Element | Document,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = "touch",
) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType,
    clientX: from.x,
    clientY: from.y,
  })
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType,
    clientX: to.x,
    clientY: to.y,
  })
}

describe("MobileNavDrawer", () => {
  it("opens via the trigger and exposes dialog semantics", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "Open nav" }))

    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(screen.getByRole("navigation", { name: "Test nav" })).toBeInTheDocument()
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const trigger = screen.getByRole("button", { name: "Open nav" })
    await user.click(trigger)
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("opens on a rightward edge swipe while closed", () => {
    const seen: boolean[] = []
    render(<Harness onOpenChange={(open) => seen.push(open)} />)

    swipe(document.body, { x: 10, y: 200 }, { x: 140, y: 210 })

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(seen).toContain(true)
  })

  it("ignores a rightward swipe that starts away from the edge", () => {
    render(<Harness />)

    swipe(document.body, { x: 200, y: 200 }, { x: 340, y: 210 })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("closes on a leftward swipe while open", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "Open nav" }))
    const drawer = screen.getByRole("dialog")

    swipe(drawer, { x: 200, y: 200 }, { x: 60, y: 205 })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("ignores mostly-vertical swipes", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "Open nav" }))
    const drawer = screen.getByRole("dialog")

    swipe(drawer, { x: 200, y: 100 }, { x: 120, y: 320 })

    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("ignores mouse drags so text selection never opens the drawer", () => {
    render(<Harness />)

    swipe(document.body, { x: 10, y: 200 }, { x: 140, y: 210 }, "mouse")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
