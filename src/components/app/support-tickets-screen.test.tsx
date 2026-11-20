import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SupportTicket } from "@/lib/support-tickets"

import { SupportTicketsScreen } from "./support-tickets-screen"

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "ticket-1",
    userId: "u1",
    subject: "Cannot sign in",
    category: "technical",
    status: "open",
    createdAt: "2026-01-10T10:00:00.000Z",
    updatedAt: "2026-01-11T10:00:00.000Z",
    messages: [
      {
        id: "msg-1",
        author: "user",
        body: "I keep getting an error.",
        createdAt: "2026-01-10T10:00:00.000Z",
      },
    ],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function listResponse(tickets: SupportTicket[] = []) {
  return jsonResponse({
    ok: true,
    tickets,
    total: tickets.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  })
}

function detailResponse(t: SupportTicket) {
  return jsonResponse({ ok: true, ticket: t })
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn().mockResolvedValue(listResponse([]))
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("SupportTicketsScreen", () => {
  it("shows a loading state then renders tickets with badges", async () => {
    mockFetch(listResponse([ticket({ status: "pending" })]))
    render(<SupportTicketsScreen />)

    expect(screen.getByText(/Loading tickets/)).toBeInTheDocument()
    expect(await screen.findByText("Cannot sign in")).toBeInTheDocument()
    expect(screen.getByText("Technical")).toBeInTheDocument()
    expect(screen.getByText("Pending")).toBeInTheDocument()
    expect(screen.getByText(/Updated/)).toBeInTheDocument()
  })

  it("shows an empty state when the user has no tickets", async () => {
    mockFetch(listResponse([]))
    render(<SupportTicketsScreen />)
    expect(await screen.findByText("No support tickets yet")).toBeInTheDocument()
  })

  it("shows an error with retry when the list fails", async () => {
    mockFetch(jsonResponse({ ok: false, message: "Backend down" }, 500))
    render(<SupportTicketsScreen />)
    expect(await screen.findByText("Backend down")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("creates a ticket and opens its detail view", async () => {
    const created = ticket({
      id: "ticket-new",
      subject: "Billing issue",
      category: "billing",
      messages: [
        {
          id: "msg-9",
          author: "user",
          body: "Charged twice",
          createdAt: "2026-01-12T00:00:00.000Z",
        },
      ],
    })
    const fetchMock = mockFetch(
      listResponse([]), // initial list load
      jsonResponse({ ok: true, ticket: created }), // POST create
      detailResponse(created), // GET detail after create
    )
    render(<SupportTicketsScreen />)

    await userEvent.click(await screen.findByRole("button", { name: /New ticket/ }))
    await userEvent.type(screen.getByLabelText("Subject"), "Billing issue")
    await userEvent.type(screen.getByLabelText("Message"), "Charged twice")
    await userEvent.click(screen.getByRole("button", { name: "Create ticket" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/support/tickets",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    expect(await screen.findByText("Charged twice")).toBeInTheDocument()
    expect(screen.getByText("Billing")).toBeInTheDocument()
  })

  it("opens a ticket detail, sends a reply, and closes the ticket", async () => {
    const open = ticket()
    const withReply = ticket({
      messages: [
        ...open.messages,
        { id: "msg-2", author: "user", body: "Any update?", createdAt: "2026-01-12T00:00:00.000Z" },
      ],
    })
    const closed = ticket({ status: "closed", messages: withReply.messages })

    const fetchMock = mockFetch(
      listResponse([open]), // initial list
      detailResponse(open), // detail load
      jsonResponse({ ok: true, ticket: withReply }), // reply POST
      jsonResponse({ ok: true, ticket: closed }), // PATCH close
    )
    render(<SupportTicketsScreen />)

    await userEvent.click(await screen.findByRole("button", { name: /Cannot sign in/ }))
    expect(await screen.findByText("I keep getting an error.")).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Reply"), "Any update?")
    await userEvent.click(screen.getByRole("button", { name: /Send reply/ }))
    expect(await screen.findByText("Any update?")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Close ticket" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/support/tickets/ticket-1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    )
    // Closed ticket: reply box replaced by the closed notice + reopen action.
    expect(await screen.findByText(/This ticket is closed/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reopen ticket" })).toBeInTheDocument()
  })

  it("hides the reply box for closed tickets", async () => {
    const closed = ticket({
      status: "closed",
      messages: [
        { id: "msg-1", author: "user", body: "Done?", createdAt: "2026-01-10T10:00:00.000Z" },
        { id: "msg-2", author: "agent", body: "All set!", createdAt: "2026-01-11T10:00:00.000Z" },
      ],
    })
    mockFetch(listResponse([closed]), detailResponse(closed))
    render(<SupportTicketsScreen />)

    await userEvent.click(await screen.findByRole("button", { name: /Cannot sign in/ }))
    expect(await screen.findByText("All set!")).toBeInTheDocument()
    expect(screen.getByText("Support")).toBeInTheDocument()
    expect(screen.queryByLabelText("Reply")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reopen ticket" })).toBeInTheDocument()
  })
})
