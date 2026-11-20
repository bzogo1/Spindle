import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Separator } from "./separator"

describe("Separator", () => {
  it("renders a horizontal separator by default", () => {
    const { container } = render(<Separator />)

    const el = container.querySelector('[data-slot="separator"]')
    expect(el).toHaveAttribute("data-orientation", "horizontal")
  })

  it("exposes role=separator when not decorative", () => {
    render(<Separator decorative={false} aria-label="Section break" />)
    expect(screen.getByRole("separator", { name: "Section break" })).toBeInTheDocument()
  })

  it("supports vertical orientation", () => {
    const { container } = render(<Separator orientation="vertical" />)
    expect(container.querySelector('[data-slot="separator"]')).toHaveAttribute(
      "data-orientation",
      "vertical",
    )
  })
})
