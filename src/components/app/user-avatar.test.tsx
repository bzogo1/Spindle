import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { UserAvatar } from "./user-avatar"

describe("UserAvatar", () => {
  it("renders the initials fallback via data-initial when no src", () => {
    const { container } = render(<UserAvatar name="bogdan zogovic" />)
    const avatar = container.querySelector(".app-avatar")
    expect(avatar).toHaveAttribute("data-initial", "B")
    expect(avatar).toHaveAttribute("aria-hidden", "true")
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })

  it("falls back to ? for empty names", () => {
    const { container } = render(<UserAvatar name="   " />)
    expect(container.querySelector(".app-avatar")).toHaveAttribute("data-initial", "?")
  })

  it("renders an image with alt text when src is set", () => {
    render(<UserAvatar name="Bogdan" src="data:image/png;base64,AAAA" />)
    const img = screen.getByRole("img", { name: "Bogdan avatar" })
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA")
  })

  it("respects a custom alt and size", () => {
    const { container } = render(
      <UserAvatar name="Bogdan" src="data:image/png;base64,AAAA" size="lg" alt="" />,
    )
    expect(container.querySelector(".app-avatar")).toHaveClass("app-avatar--lg")
    const img = container.querySelector("img")
    expect(img).toHaveAttribute("alt", "")
  })

  it("applies the small size class", () => {
    const { container } = render(<UserAvatar name="Bogdan" size="sm" />)
    expect(container.querySelector(".app-avatar")).toHaveClass("app-avatar--sm")
  })
})
