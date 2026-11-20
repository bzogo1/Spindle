/**
 * User-facing support tickets.
 *
 * In-memory dev seam: tickets live in a process-local store
 * (`createSupportTicketStore` / `supportTicketStore`) — the same best-effort
 * posture as `@/lib/feedback`. Entries are lost on restart and are not shared
 * across instances; a durable store (DB table + helpdesk sync) is the upgrade
 * path. Abuse is blunted by per-IP rate limits on the API routes plus the
 * bounds below, not by persistence.
 *
 * Scoping contract: every user-facing function takes `userId` and only ever
 * returns that user's tickets — `getTicket`/`addMessage`/`setTicketStatus`
 * answer `null`/`not_found` for foreign ids so the API cannot be used to
 * enumerate other users' tickets.
 *
 * Status lifecycle (documented decisions):
 *  - create            → "open"
 *  - user reply        → stored; a "resolved" ticket reopens to "open"
 *                        (the user is still waiting on us). "closed" tickets
 *                        reject replies — the owner must reopen first.
 *  - owner PATCH       → may only set "open" or "closed"; "pending"/"resolved"
 *                        are agent-side states.
 *  - agent reply seam  → appends an "agent" message and moves "open"/"resolved"
 *                        tickets to "pending" (agent answered, ball in the
 *                        user's court). "closed" tickets are left untouched.
 */

export const SUPPORT_TICKET_CATEGORIES = ["general", "billing", "technical", "account"] as const
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number]

export const SUPPORT_TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number]

/** Statuses a ticket owner may set on their own ticket via PATCH. */
export type OwnerSettableStatus = Extract<SupportTicketStatus, "open" | "closed">

export const SUPPORT_TICKET_LIMITS = {
  subjectMin: 3,
  subjectMax: 200,
  messageMin: 1,
  messageMax: 5000,
  /** Max tickets retained per user; oldest-first eviction is NOT done —
   *  creates beyond the cap are rejected so history is never silently lost. */
  maxTicketsPerUser: 100,
  /** Hard global cap across all users (process-local memory bound). */
  maxTickets: 1000,
  /** Max messages retained per ticket. */
  maxMessagesPerTicket: 200,
  defaultPageSize: 20,
  maxPageSize: 50,
} as const

export interface SupportTicketMessage {
  id: string
  author: "user" | "agent"
  body: string
  createdAt: string
}

export interface SupportTicket {
  id: string
  userId: string
  subject: string
  category: SupportTicketCategory
  status: SupportTicketStatus
  /** Optional free-form priority hint; reserved for agent-side tooling. */
  priority?: string
  createdAt: string
  updatedAt: string
  messages: SupportTicketMessage[]
}

export interface TicketPage {
  tickets: SupportTicket[]
  total: number
  hasMore: boolean
}

export type CreateTicketResult =
  { ok: true; ticket: SupportTicket } | { ok: false; reason: "invalid" | "limit" }

export type AddMessageResult =
  | { ok: true; ticket: SupportTicket }
  | { ok: false; reason: "not_found" | "closed" | "too_many_messages" | "invalid" }

export interface TicketListFilter {
  status?: SupportTicketStatus
  limit?: number
  offset?: number
}

export interface SupportTicketStore {
  createTicket(
    userId: string,
    input: { subject: string; category: SupportTicketCategory; message: string },
  ): CreateTicketResult
  listTickets(userId: string, filter?: TicketListFilter): TicketPage
  /** User-scoped lookup — returns null for missing AND foreign tickets. */
  getTicket(userId: string, id: string): SupportTicket | null
  addMessage(userId: string, ticketId: string, body: string): AddMessageResult
  /** Owner-scoped status change; only "open"/"closed" are accepted. */
  setTicketStatus(
    userId: string,
    ticketId: string,
    status: OwnerSettableStatus,
  ): SupportTicket | null
  /** Unscoped status change — agent/admin seam for future wiring. */
  updateTicketStatus(ticketId: string, status: SupportTicketStatus): SupportTicket | null
  /** Agent reply seam: appends an "agent" message, nudges status to "pending". */
  addAgentMessage(ticketId: string, body: string): SupportTicket | null
  clear(): void
}

function normalizeText(value: string, max: number): string | null {
  const trimmed = value.trim()
  if (trimmed.length < SUPPORT_TICKET_LIMITS.messageMin) return null
  if (trimmed.length > max) return null
  return trimmed
}

function isCategory(value: string): value is SupportTicketCategory {
  return (SUPPORT_TICKET_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Process-local ticket store. Bounded by `SUPPORT_TICKET_LIMITS`; ids are
 * time+sequence based like the other in-memory stores. `now` is injectable
 * for tests.
 */
export function createSupportTicketStore(now: () => Date = () => new Date()): SupportTicketStore {
  const tickets: SupportTicket[] = []
  let sequence = 0

  function nextId(prefix: string): string {
    sequence += 1
    return `${prefix}-${now().getTime().toString(36)}-${sequence}`
  }

  function touch(ticket: SupportTicket): void {
    ticket.updatedAt = now().toISOString()
  }

  function countForUser(userId: string): number {
    return tickets.reduce((count, t) => (t.userId === userId ? count + 1 : count), 0)
  }

  function findOwned(userId: string, ticketId: string): SupportTicket | null {
    const ticket = tickets.find((t) => t.id === ticketId)
    // Foreign and missing ids are indistinguishable — no enumeration.
    return ticket && ticket.userId === userId ? ticket : null
  }

  return {
    createTicket(userId, input) {
      const subject = input.subject.trim()
      if (
        subject.length < SUPPORT_TICKET_LIMITS.subjectMin ||
        subject.length > SUPPORT_TICKET_LIMITS.subjectMax ||
        !isCategory(input.category)
      ) {
        return { ok: false, reason: "invalid" }
      }
      const body = normalizeText(input.message, SUPPORT_TICKET_LIMITS.messageMax)
      if (body === null) return { ok: false, reason: "invalid" }

      if (tickets.length >= SUPPORT_TICKET_LIMITS.maxTickets) {
        return { ok: false, reason: "limit" }
      }
      if (countForUser(userId) >= SUPPORT_TICKET_LIMITS.maxTicketsPerUser) {
        return { ok: false, reason: "limit" }
      }

      const at = now().toISOString()
      const ticket: SupportTicket = {
        id: nextId("ticket"),
        userId,
        subject,
        category: input.category,
        status: "open",
        createdAt: at,
        updatedAt: at,
        messages: [
          {
            id: nextId("msg"),
            author: "user",
            body,
            createdAt: at,
          },
        ],
      }
      tickets.push(ticket)
      return { ok: true, ticket }
    },

    listTickets(userId, filter = {}) {
      const status = filter.status
      const limit = Math.min(
        Math.max(filter.limit ?? SUPPORT_TICKET_LIMITS.defaultPageSize, 1),
        SUPPORT_TICKET_LIMITS.maxPageSize,
      )
      const offset = Math.max(filter.offset ?? 0, 0)

      const owned = tickets
        .filter((t) => t.userId === userId && (!status || t.status === status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))

      const page = owned.slice(offset, offset + limit)
      return {
        tickets: page,
        total: owned.length,
        hasMore: offset + limit < owned.length,
      }
    },

    getTicket(userId, id) {
      const ticket = findOwned(userId, id)
      return ticket ? { ...ticket, messages: [...ticket.messages] } : null
    },

    addMessage(userId, ticketId, body) {
      const ticket = findOwned(userId, ticketId)
      if (!ticket) return { ok: false, reason: "not_found" }
      if (ticket.status === "closed") return { ok: false, reason: "closed" }
      if (ticket.messages.length >= SUPPORT_TICKET_LIMITS.maxMessagesPerTicket) {
        return { ok: false, reason: "too_many_messages" }
      }
      const normalized = normalizeText(body, SUPPORT_TICKET_LIMITS.messageMax)
      if (normalized === null) return { ok: false, reason: "invalid" }

      ticket.messages.push({
        id: nextId("msg"),
        author: "user",
        body: normalized,
        createdAt: now().toISOString(),
      })
      // A user reply on a resolved ticket means they still need help — reopen.
      if (ticket.status === "resolved") ticket.status = "open"
      touch(ticket)
      return { ok: true, ticket }
    },

    setTicketStatus(userId, ticketId, status) {
      const ticket = findOwned(userId, ticketId)
      if (!ticket) return null
      if (status !== "open" && status !== "closed") return null
      ticket.status = status
      touch(ticket)
      return ticket
    },

    updateTicketStatus(ticketId, status) {
      const ticket = tickets.find((t) => t.id === ticketId)
      if (!ticket || !(SUPPORT_TICKET_STATUSES as readonly string[]).includes(status)) {
        return null
      }
      ticket.status = status
      touch(ticket)
      return ticket
    },

    addAgentMessage(ticketId, body) {
      const ticket = tickets.find((t) => t.id === ticketId)
      if (!ticket) return null
      if (ticket.messages.length >= SUPPORT_TICKET_LIMITS.maxMessagesPerTicket) {
        return null
      }
      const normalized = normalizeText(body, SUPPORT_TICKET_LIMITS.messageMax)
      if (normalized === null) return null

      ticket.messages.push({
        id: nextId("msg"),
        author: "agent",
        body: normalized,
        createdAt: now().toISOString(),
      })
      if (ticket.status === "open" || ticket.status === "resolved") {
        ticket.status = "pending"
      }
      touch(ticket)
      return ticket
    },

    clear() {
      tickets.length = 0
      sequence = 0
    },
  }
}

/** Shared store used by `/api/support/tickets*`. */
export const supportTicketStore = createSupportTicketStore()
