import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Switch } from "./switch"

describe("Switch", () => {
  it("toggles on click and reports aria-checked", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Notifications" onCheckedChange={onCheckedChange} />)

    const toggle = screen.getByRole("switch", { name: "Notifications" })
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(toggle).toHaveAttribute("data-size", "default")

    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("supports sm size", () => {
    render(<Switch size="sm" aria-label="Compact" />)
    expect(screen.getByRole("switch", { name: "Compact" })).toHaveAttribute("data-size", "sm")
  })

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="Locked" disabled />)

    const toggle = screen.getByRole("switch", { name: "Locked" })
    expect(toggle).toBeDisabled()
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "false")
  })
})
