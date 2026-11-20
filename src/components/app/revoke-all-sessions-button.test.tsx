import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useMockSession } from "@/components/app/mock-session-provider"
import { request } from "@/lib/api/client"

import { RevokeAllSessionsButton, RevokeAllSessionsDialog } from "./revoke-all-sessions-button"

vi.mock("@/components/app/mock-session-provider", () => ({
  useMockSession: vi.fn(),
}))

vi.mock("@/lib/api/client", () => ({
  request: vi.fn(),
}))

const session = vi.mocked(useMockSession)
const apiRequest = vi.mocked(request)

function mockSession(overrides: Partial<ReturnType<typeof useMockSession>> = {}) {
  session.mockReturnValue({
    user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
    workspace: { name: "Tidal Lab", slug: "tidal-lab" },
    status: "authenticated",
    workspaces: [],
    signIn: vi.fn(),
    signOut: vi.fn(),
    switchWorkspace: vi.fn(),
    ...overrides,
  })
}

describe("RevokeAllSessionsButton", () => {
  beforeEach(() => {
    session.mockReset()
    apiRequest.mockReset()
    mockSession()
  })

  it("opens a confirmation dialog before calling the API", async () => {
    apiRequest.mockResolvedValue({ ok: true, revoked: true })

    render(<RevokeAllSessionsButton />)
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }))

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByText(/every device/i)).toBeInTheDocument()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("posts to the revoke-all endpoint then signs out locally", async () => {
    const signOut = vi.fn()
    mockSession({ signOut })
    apiRequest.mockResolvedValue({ ok: true, revoked: true })

    render(<RevokeAllSessionsButton />)
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }))
    // Trigger and confirm share the label; the confirm is rendered last.
    const confirmButtons = screen.getAllByRole("button", { name: "Sign out everywhere" })
    await userEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(apiRequest).toHaveBeenCalledWith("", "/api/auth/sessions/revoke-all", {
      method: "POST",
      body: {},
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("keeps the dialog open with an error when the request fails", async () => {
    apiRequest.mockRejectedValue(new Error("network down"))

    render(<RevokeAllSessionsButton />)
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }))
    const confirmButtons = screen.getAllByRole("button", { name: "Sign out everywhere" })
    await userEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't sign out everywhere/i)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("cancel closes the dialog without calling the API", async () => {
    render(<RevokeAllSessionsButton />)
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }))
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(apiRequest).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})

describe("RevokeAllSessionsDialog", () => {
  beforeEach(() => {
    session.mockReset()
    apiRequest.mockReset()
    mockSession()
  })

  it("does not render content while closed", () => {
    render(<RevokeAllSessionsDialog open={false} onOpenChange={vi.fn()} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
