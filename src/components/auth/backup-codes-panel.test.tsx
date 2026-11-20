import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { request } from "@/lib/api/client"

import { BackupCodesPanel } from "./backup-codes-panel"

vi.mock("@/lib/api/client", () => ({
  request: vi.fn(),
}))

const mockedRequest = vi.mocked(request)

const UNMANAGED = { ok: true, enabled: true, managed: false, remaining: null }
const MANAGED = { ok: true, enabled: true, managed: true, remaining: 7 }
const GENERATED = {
  ok: true,
  backupCodes: ["ABCD-1234", "EFGH-5678", "JKMN-9012"],
  remaining: 3,
}

function mockGet(body: unknown) {
  mockedRequest.mockResolvedValueOnce(body as never)
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe("BackupCodesPanel", () => {
  it("loads status and offers to generate codes", async () => {
    mockGet(UNMANAGED)
    render(<BackupCodesPanel />)

    expect(await screen.findByText(/No backup codes managed here yet/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Generate backup codes" })).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenCalledWith("", "/api/auth/2fa/backup-codes")
  })

  it("shows the remaining count for a managed set", async () => {
    mockGet(MANAGED)
    render(<BackupCodesPanel />)

    expect(await screen.findByText(/7 unused backup codes remaining/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Regenerate backup codes" })).toBeInTheDocument()
  })

  it("requires confirmation before regenerating and shows codes once", async () => {
    const user = userEvent.setup()
    mockGet(MANAGED)
    mockedRequest.mockResolvedValueOnce(GENERATED as never)

    render(<BackupCodesPanel />)
    await user.click(await screen.findByRole("button", { name: "Regenerate backup codes" }))

    // Confirm step warns that old codes are invalidated.
    expect(screen.getByText(/invalidates every/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Regenerate codes" }))

    expect(mockedRequest).toHaveBeenLastCalledWith("", "/api/auth/2fa/backup-codes", {
      method: "POST",
    })

    // One-time display: codes are listed and copy/dismiss actions appear.
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument()
    expect(screen.getByText("EFGH-5678")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy all codes" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "I've saved my codes" })).toBeInTheDocument()
  })

  it("dismisses the one-time view without re-fetching codes", async () => {
    const user = userEvent.setup()
    mockGet(UNMANAGED)
    mockedRequest.mockResolvedValueOnce(GENERATED as never)

    render(<BackupCodesPanel />)
    await user.click(await screen.findByRole("button", { name: "Generate backup codes" }))
    await user.click(screen.getByRole("button", { name: "Generate codes" }))
    await screen.findByText("ABCD-1234")

    await user.click(screen.getByRole("button", { name: "I've saved my codes" }))

    // Back to the managed status view; plaintext is gone for good.
    expect(await screen.findByText(/3 unused backup codes remaining/)).toBeInTheDocument()
    expect(screen.queryByText("ABCD-1234")).not.toBeInTheDocument()
  })

  it("copies all codes to the clipboard", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    mockGet(UNMANAGED)
    mockedRequest.mockResolvedValueOnce(GENERATED as never)

    render(<BackupCodesPanel />)
    await user.click(await screen.findByRole("button", { name: "Generate backup codes" }))
    await user.click(screen.getByRole("button", { name: "Generate codes" }))
    await screen.findByText("ABCD-1234")

    await user.click(screen.getByRole("button", { name: "Copy all codes" }))
    expect(writeText).toHaveBeenCalledWith("ABCD-1234\nEFGH-5678\nJKMN-9012")
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
  })

  it("shows an inline error and retries when the status request fails", async () => {
    const user = userEvent.setup()
    mockedRequest.mockRejectedValueOnce(new Error("network down"))
    mockGet(UNMANAGED)

    render(<BackupCodesPanel />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i)
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText(/No backup codes managed here yet/)).toBeInTheDocument()
  })

  it("surfaces generate failures without leaving the confirm step", async () => {
    const user = userEvent.setup()
    mockGet(UNMANAGED)
    mockedRequest.mockRejectedValueOnce(new Error("boom"))

    render(<BackupCodesPanel />)
    await user.click(await screen.findByRole("button", { name: "Generate backup codes" }))
    await user.click(screen.getByRole("button", { name: "Generate codes" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't generate/)
    // Still on the confirm step so the user can retry or cancel.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  })
})
