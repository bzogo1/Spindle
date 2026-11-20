import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { EmptyState } from "./empty-state"

describe("EmptyState", () => {
  it("renders the title, body, and both actions", async () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No files yet"
        body="Upload a file to get started."
        primaryAction={{ label: "Upload", onClick }}
        secondaryAction={{ label: "Read the guide", href: "/docs" }}
      />,
    )

    expect(screen.getByRole("heading", { name: "No files yet" })).toBeInTheDocument()
    expect(screen.getByText("Upload a file to get started.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Upload" }))
    expect(onClick).toHaveBeenCalledTimes(1)

    expect(screen.getByRole("link", { name: "Read the guide" })).toHaveAttribute("href", "/docs")
  })

  it("falls back to the shared empty copy", () => {
    render(<EmptyState />)

    expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument()
    expect(screen.getByText(/There is nothing to show yet/i)).toBeInTheDocument()
  })

  it("disables a disabled action and renders custom slots", () => {
    render(
      <EmptyState
        title="No channels"
        primaryAction={{ label: "Create channel", onClick: vi.fn(), disabled: true }}
        secondaryAction={<span>Custom slot</span>}
      />,
    )

    expect(screen.getByRole("button", { name: "Create channel" })).toBeDisabled()
    expect(screen.getByText("Custom slot")).toBeInTheDocument()
  })
})
