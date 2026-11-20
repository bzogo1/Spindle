import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthAuditEvent } from "@/lib/auth/audit"
import { AuditScreen } from "./audit-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const EVENTS: AuthAuditEvent[] = [
  {
    timestamp: "2026-02-01T12:00:00.000Z",
    type: "signin.success",
    userId: "u1",
    email: "ada@example.com",
    ip: "203.0.113.10",
    userAgent: "test",
    metadata: {},
  },
  {
    timestamp: "2026-02-01T11:00:00.000Z",
    type: "signin.failure",
    userId: "u2",
    email: "bob@example.com",
    ip: "203.0.113.11",
    userAgent: "test",
    metadata: { reason: "bad_password" },
  },
]

const STATS = {
  total: 2,
  successCount: 1,
  failureCount: 1,
  failureRate: 0.5,
  byType: { "signin.success": 1, "signin.failure": 1 },
  byDay: [{ day: "2026-02-01", count: 2 }],
  topUsers: [
    { label: "ada@example.com", email: "ada@example.com", userId: "u1", count: 1 },
    { label: "bob@example.com", email: "bob@example.com", userId: "u2", count: 1 },
  ],
}

function eventsBody(events: AuthAuditEvent[] = EVENTS, total = events.length, hasMore = false) {
  return { ok: true, events, total, hasMore, limit: 50, offset: 0 }
}

function statsBody(stats: unknown = STATS, scanned = 2) {
  return { ok: true, stats, scanned }
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(
  events: AuthAuditEvent[] = EVENTS,
  opts: { stats?: unknown; total?: number; hasMore?: boolean; eventsStatus?: number } = {},
) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("/api/admin/audit/stats")) {
      return Promise.resolve(jsonResponse(statsBody(opts.stats ?? STATS)))
    }
    if (url.startsWith("/api/admin/audit/events")) {
      if (opts.eventsStatus && opts.eventsStatus !== 200) {
        return Promise.resolve(jsonResponse({ ok: false, message: "Nope" }, opts.eventsStatus))
      }
      return Promise.resolve(
        jsonResponse(eventsBody(events, opts.total ?? events.length, opts.hasMore ?? false)),
      )
    }
    return Promise.resolve(jsonResponse({ ok: false }, 404))
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AuditScreen", () => {
  it("loads stats and events, rendering cards and the table", async () => {
    mockFetch()
    render(<AuditScreen />)

    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0)
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    expect(screen.getByText("signin.success")).toBeInTheDocument()
    expect(screen.getByText("signin.failure")).toBeInTheDocument()

    // Stat cards.
    expect(screen.getByText("Events")).toBeInTheDocument()
    expect(screen.getByText("Failures")).toBeInTheDocument()
    expect(screen.getByText("50.0%")).toBeInTheDocument()
    expect(screen.getByText("Top user")).toBeInTheDocument()

    // Pagination summary.
    expect(screen.getByText(/Showing 1–2 of 2/)).toBeInTheDocument()

    // Both endpoints were queried with cache: no-store.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.startsWith("/api/admin/audit/stats"))).toBe(true)
    expect(urls.some((u) => u.includes("/api/admin/audit/events?"))).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      cache: "no-store",
    })
  })

  it("shows the empty state when there are no events", async () => {
    mockFetch([], { stats: { ...STATS, total: 0, failureRate: null, topUsers: [] } })
    render(<AuditScreen />)
    expect(await screen.findByText("No audit events")).toBeInTheDocument()
  })

  it("shows an error state with retry on failure", async () => {
    mockFetch(EVENTS, { eventsStatus: 500 })
    render(<AuditScreen />)

    expect(await screen.findByText("Audit log unavailable")).toBeInTheDocument()
    expect(screen.getByText("Nope")).toBeInTheDocument()

    // Retry recovers once the endpoint succeeds.
    mockFetch()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0)
  })

  it("debounces the user filter into the events request", async () => {
    mockFetch()
    render(<AuditScreen />)
    await screen.findAllByText("ada@example.com")

    fetchMock.mockClear()
    const input = screen.getByLabelText("Filter by user")
    await userEvent.type(input, "ada")

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((u) => u.includes("user=ada"))).toBe(true)
    })
  })

  it("paginates with offset when hasMore is true", async () => {
    mockFetch(EVENTS, { total: 120, hasMore: true })
    render(<AuditScreen />)
    await screen.findAllByText("ada@example.com")

    fetchMock.mockClear()
    await userEvent.click(screen.getByRole("button", { name: "Next" }))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((u) => u.includes("offset=50"))).toBe(true)
    })
    // Stats are not refetched on page turns (no offset in stats calls).
    const statsCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("/api/admin/audit/stats"),
    )
    expect(statsCalls).toHaveLength(0)
  })
})
