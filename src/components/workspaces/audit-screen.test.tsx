import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceAuditScreen } from "./audit-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const EVENTS = [
  {
    id: "wae_1",
    workspaceId: "ws-1",
    type: "member.role_changed",
    actorId: "u2",
    details: { from: "member", to: "admin" },
    createdAt: "2026-02-01T12:00:00.000Z",
    actor: { id: "u2", name: "Bob", email: "bob@example.com" },
  },
  {
    id: "wae_2",
    workspaceId: "ws-1",
    type: "workspace.renamed",
    actorId: "u1",
    details: { from: "Old", to: "New" },
    createdAt: "2026-02-01T11:00:00.000Z",
    actor: { id: "u1", name: null, email: "ada@example.com" },
  },
]

const PAGE_SIZE = 50

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(
  events: unknown[] = EVENTS,
  opts: { total?: number; status?: number; message?: string } = {},
) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("/api/workspaces/ws-1/audit")) {
      if (opts.status && opts.status !== 200) {
        return Promise.resolve(
          jsonResponse({ ok: false, message: opts.message ?? "Nope" }, opts.status),
        )
      }
      const offset = Number(new URL(url, "http://localhost").searchParams.get("offset") ?? 0)
      const sliced = events.slice(offset, offset + PAGE_SIZE)
      return Promise.resolve(
        jsonResponse({
          ok: true,
          events: sliced,
          total: opts.total ?? events.length,
          limit: PAGE_SIZE,
          offset,
        }),
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

describe("WorkspaceAuditScreen", () => {
  it("loads and renders events with actor and details", async () => {
    mockFetch()
    render(<WorkspaceAuditScreen workspaceId="ws-1" />)

    expect(await screen.findByText("member.role_changed")).toBeInTheDocument()
    expect(screen.getByText("workspace.renamed")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
    // actor.name is null → falls back to email.
    expect(screen.getByText("ada@example.com")).toBeInTheDocument()
    expect(screen.getByText(/from: member/)).toBeInTheDocument()
    expect(screen.getByText(/Showing 2 of 2 events/)).toBeInTheDocument()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toContain("/api/workspaces/ws-1/audit?")
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { cache: "no-store" })
  })

  it("shows the empty state when there are no events", async () => {
    mockFetch([])
    render(<WorkspaceAuditScreen workspaceId="ws-1" />)
    expect(await screen.findByText("No audit events")).toBeInTheDocument()
  })

  it("shows a friendly state on 403 instead of an error", async () => {
    mockFetch([], { status: 403, message: "Insufficient workspace permissions." })
    render(<WorkspaceAuditScreen workspaceId="ws-1" />)
    expect(await screen.findByText("Insufficient permissions")).toBeInTheDocument()
    expect(screen.queryByText("Audit log unavailable")).not.toBeInTheDocument()
  })

  it("shows an error with retry on failure", async () => {
    mockFetch([], { status: 500, message: "Boom" })
    render(<WorkspaceAuditScreen workspaceId="ws-1" />)
    expect(await screen.findByText("Audit log unavailable")).toBeInTheDocument()
    expect(screen.getByText("Boom")).toBeInTheDocument()
    // The empty state must not render alongside the error.
    expect(screen.queryByText("No audit events")).not.toBeInTheDocument()
    expect(screen.queryByText("No matching events")).not.toBeInTheDocument()
  })

  it("appends the next page on Load more", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `wae_${i}`,
      workspaceId: "ws-1",
      type: `event.${i}`,
      actorId: null,
      details: {},
      createdAt: "2026-02-01T12:00:00.000Z",
      actor: null,
    }))
    mockFetch(many, { total: 60 })
    const user = userEvent.setup()
    render(<WorkspaceAuditScreen workspaceId="ws-1" />)

    expect(await screen.findByText("event.0")).toBeInTheDocument()
    const loadMore = screen.getByRole("button", { name: "Load more" })
    await user.click(loadMore)

    await waitFor(() => {
      expect(screen.getByText(/Showing 60 of 60 events/)).toBeInTheDocument()
    })
    expect(screen.getByText("event.59")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument()
  })

  it("sends filter params to the API", async () => {
    mockFetch()
    const user = userEvent.setup()
    render(<WorkspaceAuditScreen workspaceId="ws-1" />)
    await screen.findByText("member.role_changed")

    await user.type(screen.getByLabelText("Filter by event type"), "member")
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } })

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((u) => u.includes("type=member") && u.includes("since=2026-01-01"))).toBe(
        true,
      )
    })
  })
})
