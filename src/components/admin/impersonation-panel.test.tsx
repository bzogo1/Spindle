import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { IMPERSONATION_STATUS_EVENT } from "./impersonation-banner"
import { ImpersonationPanel } from "./impersonation-panel"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const ACTIVE_IMPERSONATION = {
  id: "imp_1",
  targetEmail: "ada@example.com",
  targetName: "Ada",
  startedAt: "2026-02-01T10:00:00.000Z",
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ImpersonationPanel", () => {
  it("shows a loading state then the start form when inactive", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, active: false }))
    render(<ImpersonationPanel />)

    expect(screen.getByText("Loading impersonation status")).toBeInTheDocument()
    expect(await screen.findByLabelText("User email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Impersonate" })).toBeInTheDocument()
  })

  it("starts an impersonation, shows the active card, and pings the shell banner", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: false }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, impersonation: ACTIVE_IMPERSONATION }))
    const onStatusChanged = vi.fn()
    window.addEventListener(IMPERSONATION_STATUS_EVENT, onStatusChanged)
    render(<ImpersonationPanel />)

    const input = await screen.findByLabelText("User email")
    await userEvent.type(input, "ada@example.com")
    await userEvent.click(screen.getByRole("button", { name: "Impersonate" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/admin/impersonate/start",
        expect.objectContaining({ method: "POST" }),
      )
    })
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(body).toEqual({ email: "ada@example.com" })

    // The panel shows the active detail card but deliberately renders NO
    // banner or stop button of its own — the AppShell banner is the single
    // source (it owns the stop flow and status polling).
    expect(await screen.findByText(/Impersonating ada@example.com/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Stop impersonating" })).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    // The shell banner is told to refetch so it appears without a 30s wait.
    expect(onStatusChanged).toHaveBeenCalled()
    window.removeEventListener(IMPERSONATION_STATUS_EVENT, onStatusChanged)
  })

  it("surfaces API errors from start", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: false }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, message: "Admin accounts cannot be impersonated." }, 403),
      )
    render(<ImpersonationPanel />)

    const input = await screen.findByLabelText("User email")
    await userEvent.type(input, "admin@example.com")
    await userEvent.click(screen.getByRole("button", { name: "Impersonate" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Admin accounts cannot be impersonated.",
    )
  })

  it("shows the active impersonation without its own stop control", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, active: true, impersonation: ACTIVE_IMPERSONATION }),
    )
    render(<ImpersonationPanel />)

    expect(await screen.findByText(/Impersonating ada@example.com/)).toBeInTheDocument()
    // Stopping is handled by the AppShell banner — the panel renders no
    // banner (fixed overlay) and no duplicate stop button.
    expect(screen.queryByRole("button", { name: "Stop impersonating" })).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows the last impersonation record for admins", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        active: false,
        lastImpersonation: {
          ...ACTIVE_IMPERSONATION,
          endedAt: "2026-02-01T10:30:00.000Z",
          endReason: "stopped",
        },
      }),
    )
    render(<ImpersonationPanel />)

    expect(await screen.findByText("Recent impersonation")).toBeInTheDocument()
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument()
    expect(screen.getByText(/stopped/)).toBeInTheDocument()
  })
})
