import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Checkbox } from "./checkbox"

describe("Checkbox", () => {
  it("toggles on click and reports state", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Agree" onCheckedChange={onCheckedChange} />)

    const checkbox = screen.getByRole("checkbox", { name: "Agree" })
    expect(checkbox).toHaveAttribute("aria-checked", "false")

    await user.click(checkbox)
    expect(checkbox).toHaveAttribute("aria-checked", "true")
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    await user.click(checkbox)
    expect(checkbox).toHaveAttribute("aria-checked", "false")
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })

  it("supports keyboard toggling with Space", async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Terms" />)

    const checkbox = screen.getByRole("checkbox", { name: "Terms" })
    checkbox.focus()
    await user.keyboard(" ")

    expect(checkbox).toHaveAttribute("aria-checked", "true")
  })

  it("respects disabled state", async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Locked" disabled />)

    const checkbox = screen.getByRole("checkbox", { name: "Locked" })
    expect(checkbox).toBeDisabled()
    await user.click(checkbox)
    expect(checkbox).toHaveAttribute("aria-checked", "false")
  })

  it("renders as checked when defaultChecked", () => {
    render(<Checkbox aria-label="Done" defaultChecked />)
    expect(screen.getByRole("checkbox", { name: "Done" })).toHaveAttribute("aria-checked", "true")
  })
})
