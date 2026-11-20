import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/lib/api/client"

import { EmergencyCodesPanel } from "./emergency-codes-panel"

vi.mock("@/lib/api/client", () => ({
  request: vi.fn(),
}))

const mockedRequest = vi.mocked(request)

const IDLE = { ok: true, active: false, remaining: null, expiresAt: null }
const ACTIVE = {
  ok: true,
  active: true,
  remaining: 7,
  expiresAt: new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString(),
}
const GENERATED = {
  ok: true,
  emergencyCodes: ["ABCD-1234", "EFGH-5678", "JKMN-9012"],
  remaining: 3,
  expiresAt: new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString(),
}

function mockGet(body: unknown) {
  mockedRequest.mockResolvedValueOnce(body as never)
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe("EmergencyCodesPanel", () => {
  it("loads status and offers to generate codes", async () => {
    mockGet(IDLE)
    render(<EmergencyCodesPanel />)

    expect(await screen.findByText(/No emergency codes yet/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate emergency codes" })).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith("", "/api/auth/emergency-codes")
  })

  it("shows the remaining count and expiry for an active set", async () => {
    mockGet(ACTIVE)
    render(<EmergencyCodesPanel />)

    expect(await screen.findByText(/7 unused emergency codes remaining/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Regenerate emergency codes" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Revoke all" })).toBeInTheDocument()
  })

  it("requires confirmation before generating and shows codes once", async () => {
    const user = userEvent.setup()
    mockGet(IDLE)
    mockedRequest.mockResolvedValueOnce(GENERATED as never)

    render(<EmergencyCodesPanel />)
    await user.click(await screen.findByRole("button", { name: "Generate emergency codes" }))

    expect(screen.getByText(/invalidates every/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Generate codes" }))

    expect(mockedRequest).toHaveBeenLastCalledWith("", "/api/auth/emergency-codes", {
      method: "POST",
    })

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy all codes" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "I've saved my codes" })).toBeInTheDocument()
  })

  it("revokes all codes after confirmation", async () => {
    const user = userEvent.setup()
    mockGet(ACTIVE)
    mockedRequest.mockResolvedValueOnce({ ok: true, revoked: true } as never)

    render(<EmergencyCodesPanel />)
    await user.click(await screen.findByRole("button", { name: "Revoke all" }))

    expect(screen.getByText(/invalidates every emergency code/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Revoke all codes" }))

    expect(mockedRequest).toHaveBeenLastCalledWith("", "/api/auth/emergency-codes", {
      method: "DELETE",
    })
    expect(await screen.findByText(/No emergency codes yet/)).toBeInTheDocument()
  })

  it("shows an inline error and retries when the status request fails", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(new Error("network down"))
    mockGet(IDLE)

    render(<EmergencyCodesPanel />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i)
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText(/No emergency codes yet/)).toBeInTheDocument()
  })
})
