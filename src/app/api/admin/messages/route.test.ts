// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearInAppMessages, listInbox } from "@/lib/in-app-messages"

import { GET, POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(method: "GET" | "POST", body?: unknown, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.40.0.${ipCounter}`,
    "content-type": "application/json",
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return (method === "GET" ? GET : POST)(
    new Request(`http://localhost/api/admin/messages`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearInAppMessages()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("POST /api/admin/messages", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("POST", { subject: "S", body: "B", kind: "info" })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await request(
      "POST",
      { subject: "S", body: "B", kind: "info" },
      cookieFor("user@example.com", "u9"),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects cross-origin requests", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/admin/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.40.9.${ipCounter}`,
          origin: "https://evil.example.com",
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
        },
        body: JSON.stringify({ subject: "S", body: "B", kind: "info" }),
      }),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("broadcasts to every inbox when userId is omitted", async () => {
    const response = await request(
      "POST",
      { subject: "Maintenance", body: "Tonight 22:00", kind: "warning" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.message.broadcast).toBe(true)
    expect(body.message.userId).toBeNull()

    expect(listInbox("user-a")).toHaveLength(1)
    expect(listInbox("user-b")).toHaveLength(1)
  })

  it("sends a direct message when userId is provided", async () => {
    const response = await request(
      "POST",
      { subject: "Hi", body: "For you", kind: "success", userId: "user-a" },
      adminCookie(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.message.broadcast).toBe(false)
    expect(body.message.userId).toBe("user-a")

    expect(listInbox("user-a")).toHaveLength(1)
    expect(listInbox("user-b")).toHaveLength(0)
  })

  it("rejects invalid bodies", async () => {
    const cookie = adminCookie()
    const bodies: unknown[] = [
      { body: "B", kind: "info" }, // missing subject
      { subject: "S", kind: "info" }, // missing body
      { subject: "   ", body: "B", kind: "info" },
      { subject: "S", body: "B" }, // missing kind
      { subject: "S", body: "B", kind: "bogus" },
      { subject: "S", body: "B", kind: "info", userId: 42 },
      { subject: "S".repeat(201), body: "B", kind: "info" },
    ]
    for (const body of bodies) {
      const response = await request("POST", body, cookie)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("rejects malformed JSON", async () => {
    ipCounter += 1
    const response = await POST(
      new Request("http://localhost/api/admin/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.40.8.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
        },
        body: "{nope",
      }),
    )
    expect(response.status).toBe(400)
  })
})

describe("GET /api/admin/messages", () => {
  it("rejects unauthenticated and non-admin callers", async () => {
    expect((await request("GET")).status).toBe(401)
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    expect((await request("GET", undefined, cookieFor("user@example.com", "u9"))).status).toBe(403)
  })

  it("lists recent direct sends newest-first, excluding broadcasts", async () => {
    await request("POST", { subject: "Broadcast", body: "all", kind: "info" }, adminCookie())
    await request(
      "POST",
      { subject: "To A", body: "a", kind: "info", userId: "user-a" },
      adminCookie(),
    )
    await request(
      "POST",
      { subject: "To B", body: "b", kind: "warning", userId: "user-b" },
      adminCookie(),
    )

    const response = await request("GET", undefined, adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0].subject).toBe("To B")
    expect(body.messages.every((m: { userId: string | null }) => m.userId !== null)).toBe(true)
  })

  it("rejects an invalid limit", async () => {
    ipCounter += 1
    const response = await GET(
      new Request("http://localhost/api/admin/messages?limit=abc", {
        headers: {
          "x-forwarded-for": `10.40.7.${ipCounter}`,
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
        },
      }),
    )
    expect(response.status).toBe(400)
  })
})
