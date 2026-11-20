// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { supportTicketStore } from "@/lib/support-tickets"
import { GET, POST } from "./route"

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

function request(
  method: string,
  options: { cookie?: string; body?: unknown; ip?: string; origin?: string; url?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? `10.9.0.${ipCounter}`,
  }
  if (options.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options.body !== undefined) headers["content-type"] = "application/json"
  if (options.origin) headers.origin = options.origin
  return new Request(options.url ?? "http://localhost/api/support/tickets", {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

const validPayload = {
  subject: "Cannot sign in",
  category: "technical" as const,
  message: "I keep getting an error.",
}

beforeEach(() => {
  supportTicketStore.clear()
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
})

describe("GET /api/support/tickets", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await GET(request("GET"))
    expect(response.status).toBe(401)
  })

  it("returns only the caller's tickets", async () => {
    supportTicketStore.createTicket(user.id, validPayload)
    supportTicketStore.createTicket("u2", { ...validPayload, subject: "Foreign ticket" })

    const response = await GET(request("GET", { cookie: accessCookie() }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.tickets).toHaveLength(1)
    expect(data.tickets[0].subject).toBe("Cannot sign in")
    expect(data.total).toBe(1)
  })

  it("filters by status and rejects unknown statuses", async () => {
    const created = supportTicketStore.createTicket(user.id, validPayload)
    if (!created.ok) throw new Error("setup failed")
    supportTicketStore.setTicketStatus(user.id, created.ticket.id, "closed")

    const closed = await GET(
      request("GET", {
        cookie: accessCookie(),
        url: "http://localhost/api/support/tickets?status=closed",
      }),
    )
    expect((await closed.json()).tickets).toHaveLength(1)

    const open = await GET(
      request("GET", {
        cookie: accessCookie(),
        url: "http://localhost/api/support/tickets?status=open",
      }),
    )
    expect((await open.json()).tickets).toHaveLength(0)

    const bad = await GET(
      request("GET", {
        cookie: accessCookie(),
        url: "http://localhost/api/support/tickets?status=bogus",
      }),
    )
    expect(bad.status).toBe(400)
  })
})

describe("POST /api/support/tickets", () => {
  it("rejects cross-origin requests", async () => {
    const response = await POST(
      request("POST", {
        cookie: accessCookie(),
        body: validPayload,
        origin: "https://evil.example",
      }),
    )
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated and malformed requests", async () => {
    expect((await POST(request("POST", { body: validPayload }))).status).toBe(401)
    expect((await POST(request("POST", { cookie: accessCookie(), body: "{nope" }))).status).toBe(
      400,
    )
    expect(
      (
        await POST(
          request("POST", {
            cookie: accessCookie(),
            body: { subject: "Hi", category: "general", message: "" },
          }),
        )
      ).status,
    ).toBe(400)
  })

  it("creates a ticket with the first user message", async () => {
    const response = await POST(request("POST", { cookie: accessCookie(), body: validPayload }))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.ticket).toMatchObject({
      userId: user.id,
      subject: "Cannot sign in",
      category: "technical",
      status: "open",
    })
    expect(data.ticket.messages[0]).toMatchObject({ author: "user" })
  })
})
