import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "./badge"

describe("Badge", () => {
  it("renders text with default variant and size", () => {
    render(<Badge>New</Badge>)

    const badge = screen.getByText("New")
    expect(badge).toHaveAttribute("data-slot", "badge")
    expect(badge).toHaveAttribute("data-variant", "default")
    expect(badge).toHaveAttribute("data-size", "default")
  })

  it("supports variants and sizes", () => {
    const { rerender } = render(<Badge variant="destructive">Fail</Badge>)
    expect(screen.getByText("Fail")).toHaveAttribute("data-variant", "destructive")

    rerender(
      <Badge variant="outline" size="lg">
        Tag
      </Badge>,
    )
    const badge = screen.getByText("Tag")
    expect(badge).toHaveAttribute("data-variant", "outline")
    expect(badge).toHaveAttribute("data-size", "lg")
  })

  it("renders as a child element when asChild", () => {
    render(
      <Badge asChild>
        <a href="/docs">Docs</a>
      </Badge>,
    )

    const link = screen.getByRole("link", { name: "Docs" })
    expect(link).toHaveAttribute("data-slot", "badge")
  })
})
