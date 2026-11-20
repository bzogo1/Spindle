// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { applyForAffiliate, clearAffiliateStoreForTests } from "@/lib/affiliate"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetTaxFormsForTests } from "@/lib/tax-forms"

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

const YEAR = new Date().getUTCFullYear()

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(
  method: "GET" | "POST",
  options: { cookie?: string; origin?: string; body?: unknown; query?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.8.2.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request(`http://localhost/api/admin/tax-forms${options.query ?? ""}`, {
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
  resetTaxFormsForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/tax-forms", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("rejects non-admin users with 403", async () => {
    const response = await request("GET", { cookie: cookieFor("user@example.com") })
    expect(response.status).toBe(403)
  })

  it("lists tax form records for admins", async () => {
    const affiliate = applyForAffiliate("user-1", "a@example.com")
    const response = await request("GET", {
      cookie: adminCookie(),
      query: `?affiliateId=${affiliate.id}`,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.forms).toEqual([])
  })

  it("exports a CSV summary with the right content type", async () => {
    applyForAffiliate("user-1", "a@example.com")
    const response = await request("GET", {
      cookie: adminCookie(),
      query: `?format=csv&year=${YEAR}`,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain("attachment")
    const csv = await response.text()
    expect(csv.split("\r\n")[0]).toBe("affiliate_id,email,year,total_paid_cents,currency,form_type")
    expect(csv).toContain("a@example.com")
  })

  it("returns 400 for a CSV export without a valid year", async () => {
    const response = await request("GET", {
      cookie: adminCookie(),
      query: "?format=csv",
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})

describe("POST /api/admin/tax-forms", () => {
  it("rejects cross-origin requests with 403", async () => {
    const response = await request("POST", {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
      body: { affiliateId: "aff_x", year: YEAR },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated and non-admin requests", async () => {
    const anon = await request("POST", { body: { affiliateId: "aff_x", year: YEAR } })
    expect(anon.status).toBe(401)

    const nonAdmin = await request("POST", {
      cookie: cookieFor("user@example.com"),
      body: { affiliateId: "aff_x", year: YEAR },
    })
    expect(nonAdmin.status).toBe(403)
  })

  it("generates a simulated 1099-NEC record", async () => {
    const affiliate = applyForAffiliate("user-1", "a@example.com")
    const response = await request("POST", {
      cookie: adminCookie(),
      body: { affiliateId: affiliate.id, year: YEAR },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.form).toMatchObject({
      affiliateId: affiliate.id,
      formType: "1099-nec",
      year: YEAR,
      status: "draft",
    })
    expect(body.data).toMatchObject({ totalPaidCents: 0, formType: "1099-NEC" })
  })

  it("returns 400 for an unknown affiliate or invalid year", async () => {
    const missing = await request("POST", {
      cookie: adminCookie(),
      body: { affiliateId: "aff_missing", year: YEAR },
    })
    expect(missing.status).toBe(400)

    const badYear = await request("POST", {
      cookie: adminCookie(),
      body: { affiliateId: "aff_x", year: 1800 },
    })
    expect(badYear.status).toBe(400)
  })
})
