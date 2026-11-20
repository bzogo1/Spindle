import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, request } from "@/lib/api/client"

import { TwoFactorRecoveryConfirm } from "./two-factor-recovery-confirm"

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

describe("TwoFactorRecoveryConfirm", () => {
  it("confirms with the token and shows the scheduled cooldown", async () => {
    const user = userEvent.setup()
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      state: "cooldown",
      executeAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
    } as never)

    render(<TwoFactorRecoveryConfirm token="tok-123" />)
    await user.click(screen.getByRole("button", { name: "Confirm recovery" }))

    expect(mockedRequest).toHaveBeenCalledWith("", "/api/auth/2fa/recovery/confirm", {
      method: "POST",
      body: { token: "tok-123" },
    })
    expect(await screen.findByText(/Recovery scheduled/)).toBeInTheDocument()
    expect(screen.getByText(/72-hour cooldown/)).toBeInTheDocument()
  })

  it("includes the optional backup code when provided", async () => {
    const user = userEvent.setup()
    mockedRequest.mockResolvedValueOnce({ ok: true, state: "cooldown" } as never)

    render(<TwoFactorRecoveryConfirm token="tok-123" />)
    await user.type(screen.getByLabelText(/Backup code/), "ABCD-1234")
    await user.click(screen.getByRole("button", { name: "Confirm recovery" }))

    expect(mockedRequest).toHaveBeenCalledWith("", "/api/auth/2fa/recovery/confirm", {
      method: "POST",
      body: { token: "tok-123", backupCode: "ABCD-1234" },
    })
  })

  it("shows the API error and allows retry", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(
      new ApiError({ status: 401, code: "invalid_token", message: "expired link" }),
    )

    render(<TwoFactorRecoveryConfirm token="tok-123" />)
    await user.click(screen.getByRole("button", { name: "Confirm recovery" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/expired link/)
    expect(screen.getByRole("button", { name: "Confirm recovery" })).toBeEnabled()
  })
})
