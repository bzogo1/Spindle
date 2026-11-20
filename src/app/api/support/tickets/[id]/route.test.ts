// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { supportTicketStore } from "@/lib/support-tickets"
import { GET, PATCH, POST } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

let ipCounter = 0

function call(
  handler: (
    request: Request,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response | undefined>,
  method: string,
  id: string,
  options: { cookie?: string; body?: unknown; ip?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `10.10.0.${ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.body !== undefined) headers["content-type"] = "application/json"
  const response = handler(
    new Request(`http://localhost/api/support/tickets/${id}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ id }) },
  )
  return response.then((res) => {
    if (!res) throw new Error("handler returned no response")
    return res
  })
}

function seedTicket(userId = user.id) {
  const result = supportTicketStore.createTicket(userId, {
    subject: "Billing question",
    category: "billing",
    message: "Why was I charged twice?",
  })
  if (!result.ok) throw new Error("setup failed")
  return result.ticket
}

beforeEach(() => {
  supportTicketStore.clear()
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
})

describe("GET /api/support/tickets/[id]", () => {
  it("rejects unauthenticated requests", async () => {
    const ticket = seedTicket()
    expect((await call(GET, "GET", ticket.id)).status).toBe(401)
  })

  it("returns the ticket for its owner", async () => {
    const ticket = seedTicket()
    const response = await call(GET, "GET", ticket.id, { cookie: accessCookie() })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ticket.id).toBe(ticket.id)
    expect(data.ticket.messages).toHaveLength(1)
  })

  it("answers 404 for foreign and missing ids (no enumeration)", async () => {
    const ticket = seedTicket()
    const foreign = await call(GET, "GET", ticket.id, { cookie: accessCookie("u2") })
    expect(foreign.status).toBe(404)
    const missing = await call(GET, "GET", "ticket-nope", { cookie: accessCookie() })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: "not_found" })
  })
})

describe("POST /api/support/tickets/[id]", () => {
  it("appends a user reply", async () => {
    const ticket = seedTicket()
    const response = await call(POST, "POST", ticket.id, {
      cookie: accessCookie(),
      body: { body: "Any update?" },
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ticket.messages).toHaveLength(2)
    expect(data.ticket.messages[1].body).toBe("Any update?")
  })

  it("reopens a resolved ticket on reply and rejects closed ones", async () => {
    const ticket = seedTicket()
    supportTicketStore.updateTicketStatus(ticket.id, "resolved")
    const reopened = await call(POST, "POST", ticket.id, {
      cookie: accessCookie(),
      body: { body: "Still happening" },
    })
    expect((await reopened.json()).ticket.status).toBe("open")

    supportTicketStore.setTicketStatus(user.id, ticket.id, "closed")
    const closed = await call(POST, "POST", ticket.id, {
      cookie: accessCookie(),
      body: { body: "hello?" },
    })
    expect(closed.status).toBe(409)
  })

  it("validates the body and scopes by owner", async () => {
    const ticket = seedTicket()
    const empty = await call(POST, "POST", ticket.id, {
      cookie: accessCookie(),
      body: { body: "   " },
    })
    expect(empty.status).toBe(400)

    const foreign = await call(POST, "POST", ticket.id, {
      cookie: accessCookie("u2"),
      body: { body: "not mine" },
    })
    expect(foreign.status).toBe(404)
  })
})

describe("PATCH /api/support/tickets/[id]", () => {
  it("lets the owner close and reopen a ticket", async () => {
    const ticket = seedTicket()
    const closed = await call(PATCH, "PATCH", ticket.id, {
      cookie: accessCookie(),
      body: { status: "closed" },
    })
    expect((await closed.json()).ticket.status).toBe("closed")

    const reopened = await call(PATCH, "PATCH", ticket.id, {
      cookie: accessCookie(),
      body: { status: "open" },
    })
    expect((await reopened.json()).ticket.status).toBe("open")
  })

  it("rejects agent-side statuses and foreign tickets", async () => {
    const ticket = seedTicket()
    const pending = await call(PATCH, "PATCH", ticket.id, {
      cookie: accessCookie(),
      body: { status: "pending" },
    })
    expect(pending.status).toBe(400)

    const foreign = await call(PATCH, "PATCH", ticket.id, {
      cookie: accessCookie("u2"),
      body: { status: "closed" },
    })
    expect(foreign.status).toBe(404)
  })
})
