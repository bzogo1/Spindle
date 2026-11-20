import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LoginAlert } from "@/lib/auth/login-alerts"

import { SecurityAlertsPanel } from "./security-alerts-panel"

const alertFixture: LoginAlert = {
  id: "la_1",
  userId: "u1",
  kind: "new_device",
  severity: "warning",
  title: "Sign-in from a new device",
  detail: "A sign-in used a browser we have not seen before.",
  ip: "203.0.113.10",
  userAgent: "TestBrowser/1.0",
  createdAt: "2026-01-01T12:00:00.000Z",
  read: false,
}

const prefsFixture = { inAppNotifications: true, emailNotifications: false }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function mockFetchSequence(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("SecurityAlertsPanel", () => {
  it("shows a loading state then the empty state", async () => {
    mockFetchSequence(
      jsonResponse({
        ok: true,
        alerts: [],
        unreadCount: 0,
        preferences: prefsFixture,
      }),
    )
    render(<SecurityAlertsPanel />)
    expect(screen.getByText(/Loading security alerts/)).toBeInTheDocument()
    await screen.findByText("No security alerts")
  })

  it("lists alerts with severity and kind labels", async () => {
    mockFetchSequence(
      jsonResponse({
        ok: true,
        alerts: [alertFixture],
        unreadCount: 1,
        preferences: prefsFixture,
      }),
    )
    render(<SecurityAlertsPanel />)
    await screen.findByText("Sign-in from a new device")
    expect(screen.getByText("Warning")).toBeInTheDocument()
    expect(screen.getByText("New device")).toBeInTheDocument()
    expect(screen.getByText("Unread")).toBeInTheDocument()
    expect(screen.getByText(/1 unread/)).toBeInTheDocument()
  })

  it("marks a single alert read via POST", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({
        ok: true,
        alerts: [alertFixture],
        unreadCount: 1,
        preferences: prefsFixture,
      }),
      jsonResponse({
        ok: true,
        alerts: [{ ...alertFixture, read: true }],
        unreadCount: 0,
        preferences: prefsFixture,
      }),
    )
    render(<SecurityAlertsPanel />)
    await user.click(await screen.findByRole("button", { name: "Mark read" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({
      action: "mark_read",
      ids: ["la_1"],
    })
    await waitFor(() => expect(screen.queryByText("Unread")).not.toBeInTheDocument())
  })

  it("marks all alerts read", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({
        ok: true,
        alerts: [alertFixture],
        unreadCount: 1,
        preferences: prefsFixture,
      }),
      jsonResponse({
        ok: true,
        alerts: [{ ...alertFixture, read: true }],
        unreadCount: 0,
        preferences: prefsFixture,
      }),
    )
    render(<SecurityAlertsPanel />)
    await user.click(await screen.findByRole("button", { name: /Mark all read/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({ action: "mark_all_read" })
  })

  it("posts preference updates", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({
        ok: true,
        alerts: [],
        unreadCount: 0,
        preferences: prefsFixture,
      }),
      jsonResponse({
        ok: true,
        alerts: [],
        unreadCount: 0,
        preferences: { inAppNotifications: true, emailNotifications: true },
      }),
    )
    render(<SecurityAlertsPanel />)
    const toggle = await screen.findByRole("switch", {
      name: "Email security alert notifications",
    })
    await user.click(toggle)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({
      action: "update_preferences",
      preferences: { emailNotifications: true },
    })
  })

  it("reverts the preference toggle when the POST fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({
        ok: true,
        alerts: [],
        unreadCount: 0,
        preferences: prefsFixture,
      }),
      jsonResponse({ ok: false, message: "boom" }, 500),
    )
    render(<SecurityAlertsPanel />)
    const toggle = await screen.findByRole("switch", {
      name: "Email security alert notifications",
    })
    // prefsFixture has emailNotifications: false — toggling flips it on.
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    // The failed save must restore the server-side value.
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(screen.getByText("Security alerts unavailable")).toBeInTheDocument()
  })

  it("shows an error with retry when the fetch fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({ ok: false, message: "boom" }, 500),
      jsonResponse({ ok: true, alerts: [], unreadCount: 0, preferences: prefsFixture }),
    )
    render(<SecurityAlertsPanel />)
    await screen.findByText("Security alerts unavailable")
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("No security alerts")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
