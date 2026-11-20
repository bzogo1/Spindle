// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearInAppMessages, sendMessage } from "@/lib/in-app-messages"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const userA = {
  id: "user-a",
  email: "a@example.com",
  name: "A",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}
const userB = {
  id: "user-b",
  email: "b@example.com",
  name: "B",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookieFor(user: typeof userA) {
  return createAccessToken({ sid: "s1", uid: user.id, email: user.email, name: user.name }).token
}

let ipCounter = 0

function request(method: "GET" | "POST", path = "", body?: unknown, user: typeof userA = userA) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.30.0.${ipCounter}`,
    "content-type": "application/json",
    cookie: `${ACCESS_COOKIE}=${cookieFor(user)}`,
  }
  return (method === "GET" ? GET : POST)(
    new Request(`http://localhost/api/messages${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (id: string) =>
    id === "user-a" ? userA : id === "user-b" ? userB : null,
  )
  clearInAppMessages()
})

describe("GET /api/messages", () => {
  it("rejects unauthenticated requests", async () => {
    ipCounter += 1
    const response = await GET(
      new Request("http://localhost/api/messages", {
        headers: { "x-forwarded-for": `10.30.9.${ipCounter}` },
      }),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("rejects tokens whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("returns the caller's inbox with broadcasts and unreadCount", async () => {
    sendMessage({ userId: "user-a", subject: "For A", body: "a", kind: "info" })
    sendMessage({ subject: "Everyone", body: "all", kind: "warning" })
    sendMessage({ userId: "user-b", subject: "For B", body: "b", kind: "success" })

    const response = await request("GET")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.unreadCount).toBe(2)
    expect(body.messages).toHaveLength(2)
    expect(body.messages.map((m: { subject: string }) => m.subject)).toEqual(["Everyone", "For A"])
    expect(body.messages.every((m: { read: boolean }) => m.read === false)).toBe(true)
  })

  it("filters to unread with ?unread=1", async () => {
    const message = sendMessage({ userId: "user-a", subject: "A", body: "a", kind: "info" })
    sendMessage({ subject: "All", body: "all", kind: "info" })
    await request("POST", "", { messageId: message.id })

    const response = await request("GET", "?unread=1")
    const body = await response.json()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].subject).toBe("All")
    expect(body.unreadCount).toBe(1)
  })

  it("rejects an invalid limit", async () => {
    const response = await request("GET", "?limit=abc")
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})

describe("POST /api/messages", () => {
  it("rejects cross-origin requests", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.30.8.${ipCounter}`,
          origin: "https://evil.example.com",
          cookie: `${ACCESS_COOKIE}=${cookieFor(userA)}`,
        },
        body: JSON.stringify({ all: true }),
      }),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.30.7.${ipCounter}`,
        },
        body: JSON.stringify({ all: true }),
      }),
    )
    expect(response.status).toBe(401)
  })

  it("marks a single message read and returns the new unreadCount", async () => {
    const message = sendMessage({ userId: "user-a", subject: "A", body: "a", kind: "info" })
    sendMessage({ subject: "All", body: "all", kind: "info" })

    const response = await request("POST", "", { messageId: message.id })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, unreadCount: 1 })
  })

  it("returns 404 for unknown or invisible message ids", async () => {
    const response = await request("POST", "", { messageId: "msg_missing" })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("marks the whole inbox read with { all: true }", async () => {
    sendMessage({ userId: "user-a", subject: "A", body: "a", kind: "info" })
    sendMessage({ subject: "All", body: "all", kind: "info" })
    sendMessage({ userId: "user-b", subject: "B", body: "b", kind: "info" })

    const response = await request("POST", "", { all: true })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.marked).toBe(2)
    expect(body.unreadCount).toBe(0)

    const inbox = await request("GET")
    expect((await inbox.json()).messages.every((m: { read: boolean }) => m.read)).toBe(true)
    // user-b's direct message is untouched.
    expect((await request("GET", "", undefined, userB)).status).toBe(200)
  })

  it("rejects malformed JSON and invalid bodies", async () => {
    ipCounter += 1
    const malformed = await POST(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.30.6.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${cookieFor(userA)}`,
        },
        body: "{nope",
      }),
    )
    expect(malformed.status).toBe(400)

    for (const body of [{}, { messageId: 42 }, { messageId: "" }]) {
      const response = await request("POST", "", body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })
})
