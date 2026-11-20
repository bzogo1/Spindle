// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import {
  applyForAffiliate,
  approveAffiliate,
  clearAffiliateStoreForTests,
  recordClick,
} from "@/lib/affiliate"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET, PATCH } from "./route"

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

function request(
  method: "GET" | "PATCH",
  options: { cookie?: string; origin?: string; body?: unknown; query?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.4.6.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : PATCH)(
    new Request(`http://localhost/api/admin/affiliates${options.query ?? ""}`, {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }
        : {}),
    }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (id: string) =>
    id === "admin-1"
      ? adminUser
      : {
          id,
          email: "user@example.com",
          name: "User",
          emailVerified: true,
          createdAt: new Date().toISOString(),
        },
  )
  setAdminEmailsForTests(["admin@example.com"])
  clearAffiliateStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/affiliates", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("rejects non-admin users with 403", async () => {
    const response = await request("GET", { cookie: cookieFor("user@example.com") })
    expect(response.status).toBe(403)
  })

  it("lists applications newest first with stats", async () => {
    const first = applyForAffiliate("user-1", "a@example.com")
    const second = applyForAffiliate("user-2", "b@example.com")

    const response = await request("GET", { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.affiliates.map((a: { id: string }) => a.id)).toEqual([second.id, first.id])
    expect(body.affiliates[0].stats).toMatchObject({ clicks: 0, conversions: 0 })
  })

  it("filters by ?status=", async () => {
    const pending = applyForAffiliate("user-1", "a@example.com")
    const active = applyForAffiliate("user-2", "b@example.com")
    approveAffiliate(active.id)
    recordClick(active.code)

    const response = await request("GET", {
      cookie: adminCookie(),
      query: "?status=active",
    })
    const body = await response.json()
    expect(body.affiliates).toHaveLength(1)
    expect(body.affiliates[0].id).toBe(active.id)
    expect(body.affiliates[0].stats.clicks).toBe(1)
    expect(pending.status).toBe("pending")
  })
})

describe("PATCH /api/admin/affiliates", () => {
  it("approves, suspends, and rejects accounts", async () => {
    const account = applyForAffiliate("user-1", "a@example.com")

    const approve = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "approve" },
    })
    expect(approve.status).toBe(200)
    expect((await approve.json()).affiliate.status).toBe("active")

    const suspend = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "suspend" },
    })
    expect((await suspend.json()).affiliate.status).toBe("suspended")

    const reject = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "reject" },
    })
    expect((await reject.json()).affiliate.status).toBe("rejected")
  })

  it("returns 409 for transitions the status machine forbids", async () => {
    const account = applyForAffiliate("user-1", "a@example.com")

    // pending accounts cannot be suspended.
    const suspendPending = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "suspend" },
    })
    expect(suspendPending.status).toBe(409)
    expect(await suspendPending.json()).toMatchObject({
      ok: false,
      code: "invalid_transition",
    })

    // Approve, then approving again is invalid; rejected is terminal.
    await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "approve" },
    })
    const reapprove = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "approve" },
    })
    expect(reapprove.status).toBe(409)

    await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "suspend" },
    })
    await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "reject" },
    })
    const revive = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: account.id, action: "approve" },
    })
    expect(revive.status).toBe(409)
  })

  it("returns 404 for an unknown id and 400 for a bad action", async () => {
    const missing = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: "aff_missing", action: "approve" },
    })
    expect(missing.status).toBe(404)

    const bad = await request("PATCH", {
      cookie: adminCookie(),
      body: { id: "aff_x", action: "delete" },
    })
    expect(bad.status).toBe(400)
  })

  it("rejects cross-origin requests with 403", async () => {
    const account = applyForAffiliate("user-1", "a@example.com")
    const response = await request("PATCH", {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
      body: { id: account.id, action: "approve" },
    })
    expect(response.status).toBe(403)
  })
})
