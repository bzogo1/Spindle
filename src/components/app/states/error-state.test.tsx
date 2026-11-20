import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/client"

import { ErrorState } from "./error-state"

describe("ErrorState", () => {
  it("announces the error with a retry and support link", () => {
    render(<ErrorState onRetry={vi.fn()} />)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Something went wrong")
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "/about#contact",
    )
    expect(screen.getByText(/No error reference is available/i)).toBeInTheDocument()
  })

  it("shows the support reference from an ApiError request id", () => {
    const error = new ApiError({
      status: 500,
      code: "server_error",
      message: "Failure",
      requestId: "req_123",
    })

    render(<ErrorState error={error} />)

    expect(screen.getByText("req_123")).toBeInTheDocument()
    expect(screen.queryByText(/No error reference/i)).not.toBeInTheDocument()
  })

  it("disables retry while retrying and reports the retry", async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState onRetry={onRetry} />)

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<ErrorState onRetry={onRetry} isRetrying />)

    const retrying = screen.getByRole("button", { name: "Trying again…" })
    expect(retrying).toBeDisabled()
    expect(retrying).toHaveAttribute("aria-busy", "true")
  })
})
