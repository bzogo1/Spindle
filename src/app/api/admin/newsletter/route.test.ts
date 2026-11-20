// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearNewsletterStore, subscribe, unsubscribe } from "@/lib/newsletter-store"

import { GET } from "./route"

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

function get(query = "", cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.1.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/newsletter${query}`, { headers }))
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearNewsletterStore()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/newsletter", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns stats and the subscriber list for an admin", async () => {
    subscribe("ada@example.com", "site-footer")
    subscribe("bob@example.com", "blog")
    unsubscribe("bob@example.com")

    const response = await get("", adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.stats.subscribers).toEqual({ total: 2, pending: 0, active: 1, unsubscribed: 1 })
    expect(body.total).toBe(2)
    expect(body.subscribers).toHaveLength(2)
    expect(body.subscribers.map((s: { email: string }) => s.email).sort()).toEqual([
      "ada@example.com",
      "bob@example.com",
    ])
  })

  it("filters by status and query", async () => {
    subscribe("ada@example.com", "site-footer")
    subscribe("bob@example.com", "blog")
    unsubscribe("bob@example.com")

    const unsubscribed = await get("?status=unsubscribed", adminCookie())
    const unsubBody = await unsubscribed.json()
    expect(unsubBody.total).toBe(1)
    expect(unsubBody.subscribers[0].email).toBe("bob@example.com")

    const searched = await get("?q=blog", adminCookie())
    const searchBody = await searched.json()
    expect(searchBody.total).toBe(1)
    expect(searchBody.subscribers[0].source).toBe("blog")
  })

  it("paginates with limit and offset", async () => {
    subscribe("a@x.io")
    subscribe("b@x.io")
    subscribe("c@x.io")

    const response = await get("?limit=2&offset=2", adminCookie())
    const body = await response.json()
    expect(body.total).toBe(3)
    expect(body.subscribers).toHaveLength(1)
    expect(body.limit).toBe(2)
    expect(body.offset).toBe(2)
  })

  it("rejects an invalid status", async () => {
    const response = await get("?status=bogus", adminCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("rejects a non-numeric limit", async () => {
    const response = await get("?limit=abc", adminCookie())
    expect(response.status).toBe(400)
  })
})
