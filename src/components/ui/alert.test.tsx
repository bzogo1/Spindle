import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Alert, AlertDescription, AlertTitle } from "./alert"

describe("Alert", () => {
  it("renders with role=alert and content", () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something happened.</AlertDescription>
      </Alert>,
    )

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Heads up")
    expect(alert).toHaveTextContent("Something happened.")
  })

  it("applies the destructive variant class", () => {
    const { container } = render(
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
      </Alert>,
    )

    expect(container.querySelector('[data-slot="alert"]')).toHaveClass("text-destructive")
  })

  it("applies semantic variant classes", () => {
    const { container, rerender } = render(<Alert variant="success" data-testid="alert" />)
    expect(container.querySelector('[data-slot="alert"]')).toHaveClass("text-emerald-700")

    rerender(<Alert variant="warning" />)
    expect(container.querySelector('[data-slot="alert"]')).toHaveClass("text-amber-700")

    rerender(<Alert variant="info" />)
    expect(container.querySelector('[data-slot="alert"]')).toHaveClass("text-sky-700")
  })

  it("accepts className passthrough", () => {
    render(<Alert className="custom-alert" data-testid="alert" />)
    expect(screen.getByTestId("alert")).toHaveClass("custom-alert")
  })
})
