import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, request } from "@/lib/api/client"

import { TwoFactorDevicesPanel } from "./two-factor-devices"

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>()
  return { ...actual, request: vi.fn() }
})

const mockedRequest = vi.mocked(request)

const DEVICES_API = "/api/auth/2fa/devices"

const deviceA = {
  id: "dev_1",
  label: "Work laptop",
  fingerprintVersion: "fp1",
  createdAt: "2026-01-01T12:00:00.000Z",
  lastUsedAt: "2026-01-02T12:00:00.000Z",
}
const deviceB = {
  id: "dev_2",
  label: "Phone",
  fingerprintVersion: "fp1",
  createdAt: "2026-01-03T12:00:00.000Z",
  lastUsedAt: "2026-01-03T12:00:00.000Z",
}

const EMPTY = {
  ok: true,
  totpEnabled: true,
  devices: [],
  currentDevice: { trusted: false, deviceId: null },
}
const WITH_DEVICES = {
  ok: true,
  totpEnabled: true,
  devices: [deviceB, deviceA],
  currentDevice: { trusted: true, deviceId: "dev_1" },
}
const TWO_FA_OFF = {
  ok: true,
  totpEnabled: false,
  devices: [],
  currentDevice: { trusted: false, deviceId: null },
}

function mockGet(body: unknown) {
  mockedRequest.mockResolvedValueOnce(body as never)
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe("TwoFactorDevicesPanel", () => {
  it("loads and shows the empty state with a trust action", async () => {
    mockGet(EMPTY)
    render(<TwoFactorDevicesPanel />)

    expect(await screen.findByText("No trusted devices")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Trust this device/ })).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith("", DEVICES_API)
  })

  it("shows the enable-2FA empty state and hides trust when 2FA is off", async () => {
    mockGet(TWO_FA_OFF)
    render(<TwoFactorDevicesPanel />)

    expect(await screen.findByText("Two-factor authentication is off")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Trust this device/ })).not.toBeInTheDocument()
  })

  it("lists devices with labels, badges, and timestamps", async () => {
    mockGet(WITH_DEVICES)
    render(<TwoFactorDevicesPanel />)

    await screen.findByText("Work laptop")
    expect(screen.getByText("Phone")).toBeInTheDocument()
    expect(screen.getByText("This device")).toBeInTheDocument()
    // Current device is already trusted — no trust button.
    expect(screen.queryByRole("button", { name: /Trust this device/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke Work laptop" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke Phone" })).toBeInTheDocument()
  })

  it("requires a 6-digit code before trusting the current device", async () => {
    const user = userEvent.setup()
    mockGet(EMPTY)
    const trustedDevice = { ...deviceA, label: "Trusted device" }
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      device: trustedDevice,
    } as never)

    render(<TwoFactorDevicesPanel />)
    await user.click(await screen.findByRole("button", { name: /Trust this device/ }))

    // The trust form appears and demands a fresh authenticator code.
    const input = await screen.findByLabelText("Authenticator code")
    const confirm = screen.getByRole("button", { name: "Trust this device" })
    expect(confirm).toBeDisabled()

    await user.type(input, "123456")
    await user.click(confirm)

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    expect(mockedRequest).toHaveBeenLastCalledWith("", `${DEVICES_API}/trust`, {
      method: "POST",
      body: { totpCode: "123456" },
    })
    // The trusted device appears in the list, flagged as current.
    expect(await screen.findByText("Trusted device")).toBeInTheDocument()
    expect(screen.getByText("This device")).toBeInTheDocument()
  })

  it("surfaces the server's trust error inside the form", async () => {
    const user = userEvent.setup()
    mockGet(EMPTY)
    mockedRequest.mockRejectedValueOnce(
      new ApiError({
        status: 401,
        code: "totp_invalid",
        message: "Invalid authenticator code. Try again.",
      }),
    )

    render(<TwoFactorDevicesPanel />)
    await user.click(await screen.findByRole("button", { name: /Trust this device/ }))
    await user.type(await screen.findByLabelText("Authenticator code"), "000000")
    await user.click(screen.getByRole("button", { name: "Trust this device" }))

    expect(await screen.findByText("Invalid authenticator code. Try again.")).toBeInTheDocument()
    // The form stays open so the user can retry.
    expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument()
  })

  it("revokes a single device via DELETE", async () => {
    const user = userEvent.setup()
    mockGet(WITH_DEVICES)
    mockedRequest.mockResolvedValueOnce({ ok: true, revoked: true } as never)

    render(<TwoFactorDevicesPanel />)
    await screen.findByText("Work laptop")
    await user.click(screen.getByRole("button", { name: "Revoke Work laptop" }))

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    expect(mockedRequest).toHaveBeenLastCalledWith("", `${DEVICES_API}/dev_1`, {
      method: "DELETE",
    })
    await waitFor(() => expect(screen.queryByText("Work laptop")).not.toBeInTheDocument())
    expect(screen.getByText("Phone")).toBeInTheDocument()
  })

  it("requires confirmation then revokes all devices", async () => {
    const user = userEvent.setup()
    mockGet(WITH_DEVICES)
    mockedRequest.mockResolvedValueOnce({ ok: true, revoked: 2 } as never)

    render(<TwoFactorDevicesPanel />)
    await screen.findByText("Work laptop")

    await user.click(screen.getByRole("button", { name: /Revoke all/ }))
    // Confirm step appears before the destructive call.
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "Confirm revoke all" }))

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    expect(mockedRequest).toHaveBeenLastCalledWith("", `${DEVICES_API}/revoke-all`, {
      method: "POST",
      body: {},
    })
    await screen.findByText("No trusted devices")
  })

  it("shows only the error — never the empty state — when loading fails", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(new Error("network down"))
    mockGet(EMPTY)

    render(<TwoFactorDevicesPanel />)
    await screen.findByText("Trusted devices unavailable")
    // Regression: the empty state must not render alongside the error.
    expect(screen.queryByText("No trusted devices")).not.toBeInTheDocument()
    expect(screen.queryByText("Loading trusted devices…")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("No trusted devices")
    expect(mockedRequest).toHaveBeenCalledTimes(2)
  })

  it("surfaces the server's error message on load failure", async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError({ status: 500, code: "server_error", message: "Store is on fire." }),
    )

    render(<TwoFactorDevicesPanel />)
    await screen.findByText("Store is on fire.")
  })
})
