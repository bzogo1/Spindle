import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { LoadingPanel } from "./loading-panel"

describe("LoadingPanel", () => {
  it("exposes a polite busy status with a screen-reader label", () => {
    render(<LoadingPanel label="Loading files" />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent("Loading files")
  })

  it("renders the requested skeleton variant", () => {
    const { container } = render(<LoadingPanel variant="table" />)

    expect(container.querySelector('[data-variant="table"]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it("renders provided children instead of the default skeleton", () => {
    render(
      <LoadingPanel label="Loading project">
        <p>Custom loader</p>
      </LoadingPanel>,
    )

    expect(screen.getByText("Custom loader")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Loading project")
  })
})
