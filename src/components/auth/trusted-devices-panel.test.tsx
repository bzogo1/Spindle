import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, request } from "@/lib/api/client"

import { TrustedDevicesPanel } from "./trusted-devices-panel"

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>()
  return { ...actual, request: vi.fn() }
})

vi.mock("@/lib/device/fingerprint-client", () => ({
  getDeviceFingerprint: vi.fn(async () => ({
    version: "fp1",
    hash: "fp1:" + "a".repeat(64),
  })),
  registerDeviceFingerprintWithServer: vi.fn(async () => true),
}))

const mockedRequest = vi.mocked(request)

const TRUST_API = "/api/auth/device-trust"

const deviceA = {
  id: "dev_1",
  label: "Work laptop",
  fingerprint: "fp1:aaaaaaaa…aaaa",
  fingerprintVersion: "fp1",
  level: "standard",
  grantedAt: "2026-01-01T12:00:00.000Z",
  expiresAt: "2026-01-31T12:00:00.000Z",
  lastSeenAt: "2026-01-02T12:00:00.000Z",
}
const deviceB = {
  id: "dev_2",
  label: "Trusted device",
  fingerprint: "fp1:bbbbbbbb…bbbb",
  fingerprintVersion: "fp1",
  level: "standard",
  grantedAt: "2026-01-03T12:00:00.000Z",
  expiresAt: "2026-02-02T12:00:00.000Z",
  lastSeenAt: "2026-01-03T12:00:00.000Z",
}

const EMPTY = {
  ok: true,
  devices: [],
  currentDevice: { trusted: false, deviceId: null },
}
const WITH_DEVICES = {
  ok: true,
  devices: [deviceB, deviceA],
  currentDevice: { trusted: true, deviceId: "dev_1" },
}

function mockGet(body: unknown) {
  mockedRequest.mockResolvedValueOnce(body as never)
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe("TrustedDevicesPanel", () => {
  it("loads and shows the empty state with a trust action", async () => {
    mockGet(EMPTY)
    render(<TrustedDevicesPanel />)

    expect(await screen.findByText("No trusted devices")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Trust this device/ })).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith("", TRUST_API)
  })

  it("lists devices with labels, expiry, and timestamps", async () => {
    mockGet(WITH_DEVICES)
    render(<TrustedDevicesPanel />)

    await screen.findByText("Work laptop")
    expect(screen.getByText("Trusted device")).toBeInTheDocument()
    expect(screen.getByText("This device")).toBeInTheDocument()
    // Expiry is displayed for each grant.
    expect(screen.getAllByText(/Trusted until/)).toHaveLength(2)
    // Current device is already trusted — no trust button.
    expect(screen.queryByRole("button", { name: /Trust this device/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke Work laptop" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke Trusted device" })).toBeInTheDocument()
  })

  it("trusts the current device with an optional label", async () => {
    const user = userEvent.setup()
    mockGet(EMPTY)
    const trustedDevice = { ...deviceA, label: "Home desktop" }
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      device: trustedDevice,
      currentDevice: { trusted: true, deviceId: "dev_1" },
    } as never)

    render(<TrustedDevicesPanel />)
    await user.click(await screen.findByRole("button", { name: /Trust this device/ }))

    const input = await screen.findByLabelText("Device label (optional)")
    await user.type(input, "Home desktop")
    await user.click(screen.getByRole("button", { name: "Trust this device" }))

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    expect(mockedRequest).toHaveBeenLastCalledWith("", TRUST_API, {
      method: "POST",
      body: { label: "Home desktop", fingerprint: "fp1:" + "a".repeat(64) },
    })
    // The trusted device appears in the list, flagged as current.
    expect(await screen.findByText("Home desktop")).toBeInTheDocument()
    expect(screen.getByText("This device")).toBeInTheDocument()
  })

  it("surfaces the server's trust error inside the form", async () => {
    const user = userEvent.setup()
    mockGet(EMPTY)
    mockedRequest.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        code: "fingerprint_required",
        message: "This device could not be identified. Reload and try again.",
      }),
    )

    render(<TrustedDevicesPanel />)
    await user.click(await screen.findByRole("button", { name: /Trust this device/ }))
    await user.click(screen.getByRole("button", { name: "Trust this device" }))

    expect(
      await screen.findByText("This device could not be identified. Reload and try again."),
    ).toBeInTheDocument()
    // The form stays open so the user can retry.
    expect(screen.getByLabelText("Device label (optional)")).toBeInTheDocument()
  })

  it("revokes a single device via DELETE", async () => {
    const user = userEvent.setup()
    mockGet(WITH_DEVICES)
    mockedRequest.mockResolvedValueOnce({ ok: true, revoked: true } as never)

    render(<TrustedDevicesPanel />)
    await screen.findByText("Work laptop")
    await user.click(screen.getByRole("button", { name: "Revoke Work laptop" }))

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    expect(mockedRequest).toHaveBeenLastCalledWith("", `${TRUST_API}/dev_1`, {
      method: "DELETE",
    })
    await waitFor(() => expect(screen.queryByText("Work laptop")).not.toBeInTheDocument())
    expect(screen.getByText("Trusted device")).toBeInTheDocument()
  })

  it("requires confirmation then revokes all devices", async () => {
    const user = userEvent.setup()
    mockGet(WITH_DEVICES)
    mockedRequest.mockResolvedValueOnce({ ok: true, revoked: 2 } as never)

    render(<TrustedDevicesPanel />)
    await screen.findByText("Work laptop")

    await user.click(screen.getByRole("button", { name: /Revoke all/ }))
    // Confirm step appears before the destructive call.
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole("button", { name: "Confirm revoke all" }))

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2))
    expect(mockedRequest).toHaveBeenLastCalledWith("", TRUST_API, {
      method: "DELETE",
    })
    await screen.findByText("No trusted devices")
  })

  it("shows only the error — never the empty state — when loading fails", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(new Error("network down"))
    mockGet(EMPTY)

    render(<TrustedDevicesPanel />)
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

    render(<TrustedDevicesPanel />)
    await screen.findByText("Store is on fire.")
  })
})
