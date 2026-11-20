import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"

function TestTooltip({ placement }: { placement?: "top" | "bottom-end" }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent placement={placement}>Helpful tip</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

describe("Tooltip", () => {
  it("shows content on hover/focus and hides on Escape", async () => {
    const user = userEvent.setup()
    render(<TestTooltip />)

    const trigger = screen.getByRole("button", { name: "Hover me" })
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    await user.hover(trigger)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Helpful tip")

    await user.unhover(trigger)
    await user.keyboard("{Escape}")
  })

  it("closes on Escape while open", async () => {
    const user = userEvent.setup()
    render(<TestTooltip />)

    const trigger = screen.getByRole("button", { name: "Hover me" })
    await user.hover(trigger)
    expect(await screen.findByRole("tooltip")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  })

  it("applies placement side attributes to content", async () => {
    const user = userEvent.setup()
    render(<TestTooltip placement="bottom-end" />)

    await user.hover(screen.getByRole("button", { name: "Hover me" }))
    const tip = await screen.findByRole("tooltip")
    expect(tip).toHaveAttribute("data-side", "bottom")
    expect(tip).toHaveAttribute("data-align", "end")
  })
})
