import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthAuditEvent } from "@/lib/auth/audit"

import { LoginHistoryScreen } from "./login-history-screen"

function event(overrides: Partial<AuthAuditEvent>): AuthAuditEvent {
  return {
    timestamp: "2026-01-15T12:00:00.000Z",
    type: "signin.success",
    userId: "u1",
    email: "ada@lab.edu",
    ip: "203.0.113.10",
    userAgent: "TestBrowser/1.0",
    metadata: {},
    ...overrides,
  }
}

const eventsFixture: AuthAuditEvent[] = [
  event({
    type: "signin.failure",
    timestamp: "2026-01-16T09:30:00.000Z",
    ip: "198.51.100.7",
    userAgent: "EvilBrowser/9.9",
    metadata: { reason: "invalid_credentials" },
  }),
  event({ type: "totp.enroll", timestamp: "2026-01-15T12:00:00.000Z" }),
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function historyResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    events: eventsFixture,
    limit: 50,
    offset: 0,
    total: eventsFixture.length,
    hasMore: false,
    ...overrides,
  })
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  // Default response for any call beyond the queued ones (filter changes
  // trigger a refetch per change).
  fetchMock.mockResolvedValue(
    jsonResponse({ ok: true, events: [], limit: 50, offset: 0, total: 0, hasMore: false }),
  )
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("LoginHistoryScreen", () => {
  it("shows a loading state then renders events with labels and badges", async () => {
    mockFetch(historyResponse())
    render(<LoginHistoryScreen />)

    expect(screen.getByText(/Loading login history/)).toBeInTheDocument()
    // Scope to the table: the type filter's <option> labels share the same text.
    const table = await screen.findByRole("table")
    const body = within(table)
    expect(body.getByText("Failed sign-in")).toBeInTheDocument()
    expect(body.getByText("Two-factor enabled")).toBeInTheDocument()
    // Failed sign-in renders a destructive "Failed" badge; enroll is "Success".
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("Success")).toBeInTheDocument()
    // Metadata reason is humanized under the event label.
    expect(screen.getByText("invalid credentials")).toBeInTheDocument()
    expect(screen.getByText("198.51.100.7")).toBeInTheDocument()
    expect(screen.getByText("EvilBrowser/9.9")).toBeInTheDocument()
    // Timestamps render in a <time> element.
    expect(document.querySelector("time")).not.toBeNull()
  })

  it("shows the empty state when there are no events", async () => {
    mockFetch(historyResponse({ events: [], total: 0 }))
    render(<LoginHistoryScreen />)
    await screen.findByText("No login history yet")
  })

  it("shows a filtered empty state with a reset action", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      historyResponse({ events: [], total: 0 }),
      historyResponse({ events: eventsFixture }),
    )
    render(<LoginHistoryScreen />)
    await screen.findByText("No login history yet")

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by event type" }),
      "signin.failure",
    )
    // The filter change triggers a refetch carrying the type param.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toContain("type=signin.failure")

    await user.click(await screen.findByRole("button", { name: /Reset filters/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2][0]).not.toContain("type=")
  })

  it("sends date range filters to the API", async () => {
    const fetchMock = mockFetch(historyResponse(), historyResponse(), historyResponse())
    render(<LoginHistoryScreen />)
    await within(await screen.findByRole("table")).findByText("Failed sign-in")

    // jsdom cannot type into input[type=date]; fire change events directly.
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-01-01" },
    })
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-01-31" },
    })

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3))
    const lastUrl = fetchMock.mock.calls.at(-1)?.[0] as string
    expect(lastUrl).toContain("from=2026-01-01")
    expect(lastUrl).toContain("to=2026-01-31")
  })

  it("loads more events when hasMore is true", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      historyResponse({ hasMore: true, total: 3 }),
      historyResponse({
        events: [event({ type: "logout", timestamp: "2026-01-14T10:00:00.000Z" })],
        offset: 2,
        total: 3,
        hasMore: false,
      }),
    )
    render(<LoginHistoryScreen />)
    await within(await screen.findByRole("table")).findByText("Failed sign-in")

    await user.click(screen.getByRole("button", { name: /Load more/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toContain("offset=2")
    await within(await screen.findByRole("table")).findByText("Sign-out")
    expect(screen.queryByRole("button", { name: /Load more/ })).not.toBeInTheDocument()
  })

  it("shows an error with retry when the fetch fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      jsonResponse({ ok: false, message: "boom" }, 500),
      historyResponse(),
    )
    render(<LoginHistoryScreen />)
    await screen.findByText("Login history unavailable")
    // The empty state must not render alongside the error.
    expect(screen.queryByText("No login history yet")).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await within(await screen.findByRole("table")).findByText("Failed sign-in")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
