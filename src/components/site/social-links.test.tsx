import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SocialLinks } from "./social-links"

describe("SocialLinks", () => {
  it("links to the Spindle GitHub repo in a new tab", () => {
    render(<SocialLinks />)

    const link = screen.getByRole("link", { name: "GitHub" })
    expect(link).toHaveAttribute("href", "https://github.com/spindle-labs/spindle")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("does not render placeholder or dead social links", () => {
    const { container } = render(<SocialLinks />)

    for (const dead of ["#github", "#x", "#discord"]) {
      expect(container.querySelector(`a[href="${dead}"]`)).toBeNull()
    }
    expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Discord" })).not.toBeInTheDocument()
  })
})
