import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Progress } from "./progress"

describe("Progress", () => {
  it("renders a progressbar with aria values", () => {
    render(<Progress value={40} aria-label="Upload" />)

    const bar = screen.getByRole("progressbar", { name: "Upload" })
    expect(bar).toHaveAttribute("aria-valuenow", "40")
    expect(bar).toHaveAttribute("data-slot", "progress")
  })

  it("reflects the value in the indicator transform", () => {
    const { container } = render(<Progress value={25} />)

    const indicator = container.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toHaveStyle({ transform: "translateX(-75%)" })
  })

  it("defaults null value to zero", () => {
    render(<Progress value={null} aria-label="Loading" />)

    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeInTheDocument()
  })
})
