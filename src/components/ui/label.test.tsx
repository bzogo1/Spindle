import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Label } from "./label"

describe("Label", () => {
  it("renders text with data-slot", () => {
    render(<Label>Email</Label>)
    expect(screen.getByText("Email")).toHaveAttribute("data-slot", "label")
  })

  it("associates with a control via htmlFor", () => {
    render(
      <>
        <Label htmlFor="email-input">Email</Label>
        <input id="email-input" />
      </>,
    )

    expect(screen.getByLabelText("Email")).toBeInTheDocument()
  })

  it("accepts className passthrough", () => {
    render(<Label className="font-bold">Name</Label>)
    expect(screen.getByText("Name")).toHaveClass("font-bold")
  })
})
