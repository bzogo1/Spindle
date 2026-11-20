import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getCurrentSession } from "@/lib/auth/auth-client"

import {
  IMPERSONATION_STATUS_EVENT,
  ImpersonationBanner,
  type ImpersonationInfo,
} from "./impersonation-banner"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const IMPERSONATION: ImpersonationInfo = {
  id: "imp_1",
  targetEmail: "ada@example.com",
  targetName: "Ada",
  startedAt: "2026-02-01T10:00:00.000Z",
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
}

const ADMIN_SESSION = {
  user: {
    id: "admin-1",
    email: "root@example.com",
    name: "Root",
    emailVerified: true,
  },
  workspace: null,
  sessionId: "admin-sid",
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("ImpersonationBanner", () => {
  it("renders nothing when no impersonation is active", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, active: false }))
    render(<ImpersonationBanner />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows the banner for an active impersonation and hides it when status turns inactive", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: true, impersonation: IMPERSONATION }))
      .mockResolvedValue(jsonResponse({ ok: true, active: false }))

    render(<ImpersonationBanner />)
    await act(async () => {})

    expect(screen.getByRole("alert")).toHaveTextContent("ada@example.com")

    // The 30s poll re-checks status; once the record is gone the banner hides.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("adopts the restored admin session and calls onStopped after stop", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: true, impersonation: IMPERSONATION }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, stopped: true, session: ADMIN_SESSION }))

    const onStopped = vi.fn()
    render(<ImpersonationBanner onStopped={onStopped} />)

    const button = await screen.findByRole("button", { name: "Stop impersonating" })
    fireEvent.click(button)

    await waitFor(() => expect(onStopped).toHaveBeenCalled())
    expect(getCurrentSession()?.user.email).toBe("root@example.com")
    expect(getCurrentSession()?.sessionId).toBe("admin-sid")
  })

  it("refetches status immediately when IMPERSONATION_STATUS_EVENT fires", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: false }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: true, impersonation: IMPERSONATION }))

    render(<ImpersonationBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    // e.g. ImpersonationPanel just started a session — no 30s poll wait.
    act(() => {
      window.dispatchEvent(new Event(IMPERSONATION_STATUS_EVENT))
    })

    expect(await screen.findByRole("alert")).toHaveTextContent("ada@example.com")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("treats a 409 session_restored stop as success and clears the banner", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: true, impersonation: IMPERSONATION }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            code: "session_restored",
            message: "Your admin session was already restored. Reload to continue.",
          },
          409,
        ),
      )

    const onStopped = vi.fn()
    render(<ImpersonationBanner onStopped={onStopped} />)

    const button = await screen.findByRole("button", { name: "Stop impersonating" })
    fireEvent.click(button)

    // The record is already closed server-side: no error is pinned and the
    // banner hides instead of waiting for the next poll.
    await waitFor(() => expect(onStopped).toHaveBeenCalled())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText(/already restored/)).not.toBeInTheDocument()
  })

  it("surfaces stop errors without calling onStopped", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, active: true, impersonation: IMPERSONATION }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, message: "No active impersonation session." }, 404),
      )

    const onStopped = vi.fn()
    render(<ImpersonationBanner onStopped={onStopped} />)

    const button = await screen.findByRole("button", { name: "Stop impersonating" })
    fireEvent.click(button)

    expect(await screen.findByText("No active impersonation session.")).toBeInTheDocument()
    expect(onStopped).not.toHaveBeenCalled()
  })
})
