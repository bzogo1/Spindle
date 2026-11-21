import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PlanCards } from "./home-islands"

describe("PlanCards", () => {
  it("applies the shared card styles to the featured Hobby card", () => {
    render(<PlanCards />)

    const hobby = screen.getByText("Hobby").closest(".ui-plan-card")
    const enterprise = screen.getByText("Enterprise").closest(".ui-plan-card")

    expect(hobby).toHaveClass("ui-plan-card", "ui-plan-card--featured")
    expect(enterprise).toHaveClass("ui-plan-card")
    expect(enterprise).not.toHaveClass("ui-plan-card--featured")
  })
})
