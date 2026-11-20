import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button } from "./button"

describe("Button", () => {
  it("renders a button and fires onClick", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveAttribute("data-slot", "button")
    expect(button).toHaveAttribute("data-variant", "default")

    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("exposes variant and size as data attributes", () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    )

    const button = screen.getByRole("button", { name: "Delete" })
    expect(button).toHaveAttribute("data-variant", "destructive")
    expect(button).toHaveAttribute("data-size", "sm")
    expect(button).toHaveClass("bg-destructive")
  })

  it("renders as a child element when asChild", () => {
    render(
      <Button asChild>
        <a href="/next">Next</a>
      </Button>,
    )

    const link = screen.getByRole("link", { name: "Next" })
    expect(link).toHaveAttribute("data-slot", "button")
  })

  it("merges a custom className with the variant classes", () => {
    render(<Button className="w-full">Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveClass("w-full")
    expect(button).toHaveClass("bg-primary")
    expect(button).toHaveClass("h-9")
  })

  it("lets a conflicting className override the variant utility", () => {
    render(<Button className="px-8">Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveClass("px-8")
    expect(button).not.toHaveClass("px-4")
  })
})
