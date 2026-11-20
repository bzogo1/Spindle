// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { applyForAffiliate, approveAffiliate, clearAffiliateStoreForTests } from "@/lib/affiliate"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearPartnerPortalStoreForTests } from "@/lib/partner-portal"

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

let ipCounter = 0

function request(
  method: "GET" | "POST",
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.5.3.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request("http://localhost/api/admin/partner-portal", {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }
        : {}),
    }),
  )
}

function cookieFor(email: string, uid: string) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (id: string) =>
    id === "admin-1"
      ? adminUser
      : {
          id,
          email: `${id}@example.com`,
          name: "User",
          emailVerified: true,
          createdAt: new Date().toISOString(),
        },
  )
  setAdminEmailsForTests(["admin@example.com"])
  clearAffiliateStoreForTests()
  clearPartnerPortalStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/partner-portal", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    expect((await request("GET")).status).toBe(401)
    expect((await request("GET", { cookie: cookieFor("user@example.com", "user-1") })).status).toBe(
      403,
    )
  })

  it("lists partners with profiles, stats, announcements, and links", async () => {
    const account = applyForAffiliate("user-1", "a@example.com")
    approveAffiliate(account.id)

    const response = await request("GET", { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.partners).toHaveLength(1)
    expect(body.partners[0]).toMatchObject({
      id: account.id,
      email: "a@example.com",
      status: "active",
      profile: null,
    })
    expect(body.partners[0].stats).toMatchObject({ clicks: 0, conversions: 0 })
    expect(body.announcements).toEqual([])
    expect(body.links).toEqual([])
  })
})

describe("POST /api/admin/partner-portal", () => {
  it("publishes an announcement", async () => {
    const response = await request("POST", {
      cookie: adminCookie(),
      body: {
        kind: "announcement",
        title: "Payout update",
        body: "New schedule",
        audience: "active",
      },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.announcement).toMatchObject({ title: "Payout update", audience: "active" })

    const list = await request("GET", { cookie: adminCookie() })
    expect((await list.json()).announcements).toHaveLength(1)
  })

  it("adds a resource link and rejects unsafe URLs", async () => {
    const good = await request("POST", {
      cookie: adminCookie(),
      body: { kind: "resource", title: "Guide", url: "/docs/partners" },
    })
    expect(good.status).toBe(200)

    const bad = await request("POST", {
      cookie: adminCookie(),
      body: { kind: "resource", title: "Bad", url: "http://insecure.example.com" },
    })
    expect(bad.status).toBe(400)
  })

  it("rejects bad payloads, non-admins, and cross-origin requests", async () => {
    const badKind = await request("POST", {
      cookie: adminCookie(),
      body: { kind: "payout", title: "x" },
    })
    expect(badKind.status).toBe(400)

    const nonAdmin = await request("POST", {
      cookie: cookieFor("user@example.com", "user-1"),
      body: { kind: "announcement", title: "t", body: "b" },
    })
    expect(nonAdmin.status).toBe(403)

    const crossOrigin = await request("POST", {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
      body: { kind: "announcement", title: "t", body: "b" },
    })
    expect(crossOrigin.status).toBe(403)
  })
})
