import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/lib/api/client"

import { TwoFactorRecoveryRequest } from "./two-factor-recovery-request"

vi.mock("@/lib/api/client", () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(init: { message: string }) {
      super(init.message)
    }
  },
}))

const mockedRequest = vi.mocked(request)

beforeEach(() => {
  mockedRequest.mockReset()
})

describe("TwoFactorRecoveryRequest", () => {
  it("sends the recovery request and shows the emailed confirmation", async () => {
    const user = userEvent.setup()
    const onRequested = vi.fn()
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      state: "awaiting_token",
      emailSent: true,
    } as never)

    render(<TwoFactorRecoveryRequest onRequested={onRequested} />)
    await user.click(screen.getByRole("button", { name: "Email me a recovery link" }))

    expect(mockedRequest).toHaveBeenCalledWith("", "/api/auth/2fa/recovery/request", {
      method: "POST",
      body: {},
    })
    expect(await screen.findByText(/single-use recovery link/)).toBeInTheDocument()
    expect(onRequested).toHaveBeenCalled()
  })

  it("shows the resend throttle instead of pretending a new email was sent", async () => {
    const user = userEvent.setup()
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      state: "awaiting_token",
      emailSent: false,
      retryAfterSeconds: 240,
    } as never)

    render(<TwoFactorRecoveryRequest />)
    await user.click(screen.getByRole("button", { name: "Email me a recovery link" }))

    expect(await screen.findByRole("status")).toHaveTextContent(/try again in 240 seconds/)
  })

  it("shows a retryable error when the API reports sendFailed", async () => {
    const user = userEvent.setup()
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      state: "awaiting_token",
      emailSent: false,
      sendFailed: true,
    } as never)

    render(<TwoFactorRecoveryRequest />)
    await user.click(screen.getByRole("button", { name: "Email me a recovery link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't be sent/)
    // Back to idle — not the throttled "wait" state, not the "sent" state.
    expect(screen.getByRole("button", { name: "Email me a recovery link" })).toBeEnabled()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("surfaces API errors and returns to the idle state", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(new Error("boom"))

    render(<TwoFactorRecoveryRequest />)
    await user.click(screen.getByRole("button", { name: "Email me a recovery link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't send/)
    expect(screen.getByRole("button", { name: "Email me a recovery link" })).toBeEnabled()
  })
})
