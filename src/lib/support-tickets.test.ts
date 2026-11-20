import { describe, expect, it } from "vitest"

import {
  createSupportTicketStore,
  SUPPORT_TICKET_LIMITS,
  type SupportTicketStore,
} from "./support-tickets"

function makeStore() {
  let tick = 0
  const store = createSupportTicketStore(() => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)))
  return store
}

function create(store: SupportTicketStore, userId = "u1", subject = "Login broken") {
  const result = store.createTicket(userId, {
    subject,
    category: "technical",
    message: "I cannot sign in.",
  })
  if (!result.ok) throw new Error(`create failed: ${result.reason}`)
  return result.ticket
}

describe("createSupportTicketStore", () => {
  it("creates a ticket with the first user message and open status", () => {
    const store = makeStore()
    const ticket = create(store)
    expect(ticket.userId).toBe("u1")
    expect(ticket.status).toBe("open")
    expect(ticket.category).toBe("technical")
    expect(ticket.messages).toHaveLength(1)
    expect(ticket.messages[0]).toMatchObject({ author: "user", body: "I cannot sign in." })
    expect(ticket.createdAt).toBe(ticket.updatedAt)
  })

  it("rejects invalid subjects, categories, and empty messages", () => {
    const store = makeStore()
    expect(store.createTicket("u1", { subject: "ab", category: "general", message: "hi" }).ok).toBe(
      false,
    )
    expect(
      store.createTicket("u1", {
        subject: "Valid subject",
        category: "nope" as never,
        message: "hi",
      }).ok,
    ).toBe(false)
    expect(
      store.createTicket("u1", { subject: "Valid subject", category: "general", message: "  " }).ok,
    ).toBe(false)
    expect(
      store.createTicket("u1", {
        subject: "Valid subject",
        category: "general",
        message: "x".repeat(SUPPORT_TICKET_LIMITS.messageMax + 1),
      }).ok,
    ).toBe(false)
  })

  it("enforces the per-user ticket cap without evicting history", () => {
    const store = makeStore()
    for (let i = 0; i < SUPPORT_TICKET_LIMITS.maxTicketsPerUser; i += 1) {
      create(store, "u1", `Ticket ${i}`)
    }
    const denied = store.createTicket("u1", {
      subject: "One too many",
      category: "general",
      message: "hello",
    })
    expect(denied).toEqual({ ok: false, reason: "limit" })
    // Another user is unaffected.
    expect(create(store, "u2").userId).toBe("u2")
  })
})

describe("listTickets", () => {
  it("returns only the caller's tickets, newest-updated first", () => {
    const store = makeStore()
    const first = create(store, "u1", "First")
    create(store, "u2", "Foreign")
    const second = create(store, "u1", "Second")

    const page = store.listTickets("u1")
    expect(page.tickets.map((t) => t.id)).toEqual([second.id, first.id])
    expect(page.total).toBe(2)
    expect(page.hasMore).toBe(false)
  })

  it("filters by status and paginates", () => {
    const store = makeStore()
    const a = create(store, "u1", "Ticket A")
    const b = create(store, "u1", "Ticket B")
    store.setTicketStatus("u1", b.id, "closed")

    expect(store.listTickets("u1", { status: "closed" }).tickets.map((t) => t.id)).toEqual([b.id])
    expect(store.listTickets("u1", { status: "open" }).tickets.map((t) => t.id)).toEqual([a.id])

    const page = store.listTickets("u1", { limit: 1, offset: 1 })
    expect(page.tickets).toHaveLength(1)
    expect(page.total).toBe(2)
    expect(page.hasMore).toBe(false)
  })
})

describe("getTicket", () => {
  it("is user-scoped: foreign and missing ids both return null", () => {
    const store = makeStore()
    const ticket = create(store, "u1")
    expect(store.getTicket("u1", ticket.id)?.id).toBe(ticket.id)
    expect(store.getTicket("u2", ticket.id)).toBeNull()
    expect(store.getTicket("u1", "ticket-nope")).toBeNull()
  })
})

describe("addMessage", () => {
  it("appends a user reply and bumps updatedAt", () => {
    const store = makeStore()
    const ticket = create(store)
    const previousUpdatedAt = ticket.updatedAt
    const result = store.addMessage("u1", ticket.id, "Still broken")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.messages).toHaveLength(2)
    expect(result.ticket.messages[1]).toMatchObject({ author: "user", body: "Still broken" })
    expect(result.ticket.updatedAt > previousUpdatedAt).toBe(true)
  })

  it("reopens a resolved ticket when the user replies", () => {
    const store = makeStore()
    const ticket = create(store)
    store.updateTicketStatus(ticket.id, "resolved")
    const result = store.addMessage("u1", ticket.id, "It happened again")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ticket.status).toBe("open")
  })

  it("rejects replies on closed tickets and foreign tickets", () => {
    const store = makeStore()
    const ticket = create(store)
    store.setTicketStatus("u1", ticket.id, "closed")
    expect(store.addMessage("u1", ticket.id, "hello")).toEqual({
      ok: false,
      reason: "closed",
    })
    expect(store.addMessage("u2", ticket.id, "hello")).toEqual({
      ok: false,
      reason: "not_found",
    })
  })

  it("caps messages per ticket", () => {
    const store = makeStore()
    const ticket = create(store)
    for (let i = 0; i < SUPPORT_TICKET_LIMITS.maxMessagesPerTicket - 1; i += 1) {
      store.addMessage("u1", ticket.id, `msg ${i}`)
    }
    expect(store.addMessage("u1", ticket.id, "one more")).toEqual({
      ok: false,
      reason: "too_many_messages",
    })
  })
})

describe("status transitions", () => {
  it("owner can only set open or closed", () => {
    const store = makeStore()
    const ticket = create(store)
    expect(store.setTicketStatus("u1", ticket.id, "closed")?.status).toBe("closed")
    expect(store.setTicketStatus("u1", ticket.id, "pending" as never)).toBeNull()
    expect(store.setTicketStatus("u2", ticket.id, "open")).toBeNull()
  })

  it("agent reply seam appends agent messages and pends open/resolved tickets", () => {
    const store = makeStore()
    const ticket = create(store)
    const replied = store.addAgentMessage(ticket.id, "Looking into it")
    expect(replied?.status).toBe("pending")
    expect(replied?.messages.at(-1)).toMatchObject({ author: "agent" })

    store.updateTicketStatus(ticket.id, "resolved")
    store.addAgentMessage(ticket.id, "Fixed?")
    expect(store.getTicket("u1", ticket.id)?.status).toBe("pending")

    store.updateTicketStatus(ticket.id, "closed")
    store.addAgentMessage(ticket.id, "Note")
    const closed = store.getTicket("u1", ticket.id)
    expect(closed?.status).toBe("closed")
    expect(closed?.messages.at(-1)?.author).toBe("agent")
  })
})
