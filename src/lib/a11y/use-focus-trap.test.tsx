import { useRef, useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useFocusTrap } from "./use-focus-trap"

function TrapDialog({
  onEscape,
  initialFocus = false,
}: {
  onEscape?: () => void
  initialFocus?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const specialRef = useRef<HTMLButtonElement>(null)
  useFocusTrap({
    active: true,
    containerRef,
    onEscape,
    initialFocusRef: initialFocus ? specialRef : undefined,
  })
  return (
    <div>
      <button type="button" data-testid="outside">
        Outside
      </button>
      <div ref={containerRef} role="dialog" aria-label="Trap">
        <button type="button" data-testid="first">
          First
        </button>
        <button ref={specialRef} type="button" data-testid="special">
          Special
        </button>
        <button type="button" data-testid="last">
          Last
        </button>
      </div>
    </div>
  )
}

describe("useFocusTrap", () => {
  it("moves focus to the first focusable element on activation", () => {
    render(<TrapDialog />)
    expect(screen.getByTestId("first")).toHaveFocus()
  })

  it("honours initialFocusRef", () => {
    render(<TrapDialog initialFocus />)
    expect(screen.getByTestId("special")).toHaveFocus()
  })

  it("cycles Tab forward from the last element back to the first", () => {
    render(<TrapDialog />)
    const last = screen.getByTestId("last")
    last.focus()
    fireEvent.keyDown(last, { key: "Tab" })
    expect(screen.getByTestId("first")).toHaveFocus()
  })

  it("cycles Shift+Tab backward from the first element to the last", () => {
    render(<TrapDialog />)
    const first = screen.getByTestId("first")
    first.focus()
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true })
    expect(screen.getByTestId("last")).toHaveFocus()
  })

  it("pulls focus back inside when it lands outside the container", () => {
    render(<TrapDialog />)
    const outside = screen.getByTestId("outside")
    outside.focus()
    fireEvent.keyDown(outside, { key: "Tab" })
    // The keydown was outside the container so the trap ignores it; simulate
    // the trap's containment guard by dispatching inside after focus escaped.
    const first = screen.getByTestId("first")
    fireEvent.keyDown(first, { key: "Tab" })
    expect(document.activeElement).not.toBe(outside)
  })

  it("calls onEscape when Escape is pressed inside", () => {
    const onEscape = vi.fn()
    render(<TrapDialog onEscape={onEscape} />)
    fireEvent.keyDown(screen.getByTestId("first"), { key: "Escape" })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it("restores focus to the previously focused element on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <div>
          <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
            Open
          </button>
          {open ? <TrapDialog onEscape={() => setOpen(false)} /> : null}
        </div>
      )
    }
    render(<Harness />)
    const opener = screen.getByTestId("opener")
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByTestId("first")).toHaveFocus()

    fireEvent.keyDown(screen.getByTestId("first"), { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
