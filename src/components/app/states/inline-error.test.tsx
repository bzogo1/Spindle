import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/client"

import { InlineError } from "./inline-error"

describe("InlineError", () => {
  it("renders a destructive alert with the message", () => {
    render(<InlineError title="Could not save" message="Enter a valid email address." />)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Could not save")
    expect(alert).toHaveTextContent("Enter a valid email address.")
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument()
  })

  it("renders the message without a heading when title is null", () => {
    render(<InlineError title={null} message="Workspace name is required." />)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Workspace name is required.")
    expect(alert).not.toHaveTextContent("Could not save")
  })

  it("shows the request reference when one is available", () => {
    const error = new ApiError({
      status: 400,
      code: "validation_error",
      message: "Invalid",
      requestId: "req_abc",
    })

    render(<InlineError error={error} />)

    expect(screen.getByText("req_abc")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(/Reference/)
  })
})
