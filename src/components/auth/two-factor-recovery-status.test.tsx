import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/lib/api/client"

import { TwoFactorRecoveryStatus } from "./two-factor-recovery-status"

vi.mock("@/lib/api/client", () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(init: { message: string }) {
      super(init.message)
    }
  },
}))

const mockedRequest = vi.mocked(request)

const COOLDOWN = {
  ok: true,
  state: "cooldown",
  executeAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
  secondsRemaining: 48 * 3600,
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe("TwoFactorRecoveryStatus", () => {
  it("renders nothing when no recovery exists", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, state: "none" } as never)
    const { container } = render(<TwoFactorRecoveryStatus />)
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("shows the awaiting-token state with a cancel action", async () => {
    mockedRequest.mockResolvedValue({ ok: true, state: "awaiting_token" } as never)
    render(<TwoFactorRecoveryStatus />)

    expect(await screen.findByText(/waiting for the emailed confirmation/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel recovery" })).toBeInTheDocument()
  })

  it("shows the cooldown countdown and cancels via the API", async () => {
    const user = userEvent.setup()
    mockedRequest
      .mockResolvedValueOnce(COOLDOWN as never) // initial GET
      .mockResolvedValueOnce({ ok: true, state: "cancelled" } as never) // POST cancel
      .mockResolvedValueOnce({ ok: true, state: "none" } as never) // reload GET

    render(<TwoFactorRecoveryStatus />)

    expect(await screen.findByText(/will be\s+disabled in/)).toBeInTheDocument()
    expect(screen.getByText(/2d 0h/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Cancel recovery" }))

    expect(mockedRequest).toHaveBeenCalledWith("", "/api/auth/2fa/recovery/cancel", {
      method: "POST",
      body: {},
    })
    // After cancel + reload the panel disappears (state "none").
    await vi.waitFor(() =>
      expect(screen.queryByText(/Two-factor recovery/)).not.toBeInTheDocument(),
    )
  })

  it("shows the completion notice once the recovery finishes", async () => {
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      state: "completed",
      enabled: false,
    } as never)

    render(<TwoFactorRecoveryStatus />)

    expect(await screen.findByText(/was disabled by the recovery flow/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancel recovery" })).not.toBeInTheDocument()
  })

  it("offers a retry when the status request fails", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(new Error("down"))
    mockedRequest.mockResolvedValueOnce({ ok: true, state: "none" } as never)

    render(<TwoFactorRecoveryStatus />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i)
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await vi.waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
  })
})
