import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "@/components/ui/bottom-sheet"

function Harness({ onSwipeDown }: { onSwipeDown?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <BottomSheet open={open} onOpenChange={setOpen}>
      <BottomSheetTrigger>Open sheet</BottomSheetTrigger>
      <BottomSheetContent onSwipeDown={onSwipeDown}>
        <BottomSheetHeader>
          <BottomSheetTitle>Sheet title</BottomSheetTitle>
          <BottomSheetDescription>Sheet description</BottomSheetDescription>
        </BottomSheetHeader>
        <button type="button">Sheet action</button>
        <BottomSheetFooter>
          <BottomSheetClose>Done</BottomSheetClose>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  )
}

function swipeDown(target: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: "touch",
    clientX: from.x,
    clientY: from.y,
  })
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: "touch",
    clientX: to.x,
    clientY: to.y,
  })
}

describe("BottomSheet", () => {
  it("opens on trigger click with dialog semantics in a portal", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open sheet" }))

    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAccessibleName("Sheet title")
    expect(screen.getByRole("button", { name: "Sheet action" })).toBeInTheDocument()
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const trigger = screen.getByRole("button", { name: "Open sheet" })
    await user.click(trigger)
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("closes via the footer close button", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    await user.click(screen.getByRole("button", { name: "Done" }))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("fires onSwipeDown for a downward touch swipe inside the sheet", async () => {
    const user = userEvent.setup()
    const onSwipeDown = vi.fn()
    render(<Harness onSwipeDown={onSwipeDown} />)

    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    const sheet = screen.getByRole("dialog")

    swipeDown(sheet, { x: 100, y: 80 }, { x: 100, y: 200 })

    expect(onSwipeDown).toHaveBeenCalledTimes(1)
  })

  it("ignores upward and mostly-horizontal swipes", async () => {
    const user = userEvent.setup()
    const onSwipeDown = vi.fn()
    render(<Harness onSwipeDown={onSwipeDown} />)

    await user.click(screen.getByRole("button", { name: "Open sheet" }))
    const sheet = screen.getByRole("dialog")

    swipeDown(sheet, { x: 100, y: 200 }, { x: 100, y: 80 })
    swipeDown(sheet, { x: 40, y: 80 }, { x: 240, y: 200 })

    expect(onSwipeDown).not.toHaveBeenCalled()
  })
})
