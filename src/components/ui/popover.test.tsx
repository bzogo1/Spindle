import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function TestPopover({ modal = false }: { modal?: boolean }) {
  return (
    <Popover modal={modal}>
      <PopoverTrigger>Open popover</PopoverTrigger>
      <PopoverContent>
        <button type="button">Inside action</button>
        <PopoverClose>Dismiss</PopoverClose>
      </PopoverContent>
    </Popover>
  )
}

describe("Popover", () => {
  it("opens on trigger click and renders content in a portal", async () => {
    const user = userEvent.setup()
    render(<TestPopover />)

    expect(screen.queryByText("Inside action")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Open popover" }))

    expect(screen.getByText("Inside action")).toBeInTheDocument()
    expect(screen.getByText("Dismiss")).toBeInTheDocument()
  })

  it("closes when the trigger is clicked again", async () => {
    const user = userEvent.setup()
    render(<TestPopover />)

    const trigger = screen.getByRole("button", { name: "Open popover" })
    await user.click(trigger)
    expect(screen.getByText("Inside action")).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByText("Inside action")).not.toBeInTheDocument()
  })

  it("closes via PopoverClose", async () => {
    const user = userEvent.setup()
    render(<TestPopover />)

    await user.click(screen.getByRole("button", { name: "Open popover" }))
    await user.click(screen.getByRole("button", { name: "Dismiss" }))

    expect(screen.queryByText("Inside action")).not.toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<TestPopover />)

    await user.click(screen.getByRole("button", { name: "Open popover" }))
    expect(screen.getByText("Inside action")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByText("Inside action")).not.toBeInTheDocument()
  })

  it("closes on outside pointer down", async () => {
    const user = userEvent.setup()
    render(
      <div>
        <TestPopover />
        <button type="button">Outside</button>
      </div>,
    )

    await user.click(screen.getByRole("button", { name: "Open popover" }))
    expect(screen.getByText("Inside action")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Outside" }))
    expect(screen.queryByText("Inside action")).not.toBeInTheDocument()
  })

  it("moves focus into content and returns it to the trigger on close in modal mode", async () => {
    const user = userEvent.setup()
    render(<TestPopover modal />)

    const trigger = screen.getByRole("button", { name: "Open popover" })
    await user.click(trigger)

    const inside = screen.getByRole("button", { name: "Inside action" })
    await vi.waitFor(() => expect(inside).toHaveFocus())

    await user.keyboard("{Escape}")
    await vi.waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByText("Inside action")).not.toBeInTheDocument()
  })

  it("supports controlled open state", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Popover open onOpenChange={onOpenChange}>
        <PopoverTrigger>Controlled</PopoverTrigger>
        <PopoverContent>Always open</PopoverContent>
      </Popover>,
    )

    expect(screen.getByText("Always open")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("supports a custom trigger element via asChild", async () => {
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverTrigger asChild>
          <a href="#details">Details link</a>
        </PopoverTrigger>
        <PopoverContent>Link popover body</PopoverContent>
      </Popover>,
    )

    const trigger = screen.getByRole("link", { name: "Details link" })
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")

    await user.click(trigger)
    expect(screen.getByText("Link popover body")).toBeInTheDocument()
  })

  it("supports anchoring to a non-trigger element", async () => {
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverAnchor>
          <div data-testid="anchor-box">Anchor area</div>
        </PopoverAnchor>
        <PopoverTrigger>Open anchored</PopoverTrigger>
        <PopoverContent>Anchored content</PopoverContent>
      </Popover>,
    )

    await user.click(screen.getByRole("button", { name: "Open anchored" }))
    expect(screen.getByText("Anchored content")).toBeInTheDocument()
  })

  it("keeps the outer popover open when a nested popover closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverTrigger>Outer trigger</PopoverTrigger>
        <PopoverContent>
          <span>Outer body</span>
          <Popover>
            <PopoverTrigger>Inner trigger</PopoverTrigger>
            <PopoverContent>Inner body</PopoverContent>
          </Popover>
        </PopoverContent>
      </Popover>,
    )

    await user.click(screen.getByRole("button", { name: "Outer trigger" }))
    expect(screen.getByText("Outer body")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Inner trigger" }))
    expect(screen.getByText("Inner body")).toBeInTheDocument()

    // Escape dismisses only the innermost layer.
    await user.keyboard("{Escape}")
    await vi.waitFor(() => expect(screen.queryByText("Inner body")).not.toBeInTheDocument())
    expect(screen.getByText("Outer body")).toBeInTheDocument()
  })
})
