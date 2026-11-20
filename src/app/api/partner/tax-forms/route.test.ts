// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

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

const USER = {
  id: "user-partner",
  email: "partner@example.com",
  name: "Partner",
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
    "x-forwarded-for": `10.9.4.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request("http://localhost/api/partner/tax-forms", {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }
        : {}),
    }),
  )
}

function authCookie(uid = USER.id, email = USER.email) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

/** Links an affiliate account to USER so resolvePartner finds it. */
function linkAccount() {
  return applyForAffiliate(USER.id, USER.email)
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockImplementation(async (id: string) =>
    id === USER.id
      ? USER
      : {
          id,
          email: "other@example.com",
          name: "Other",
          emailVerified: true,
          createdAt: new Date().toISOString(),
        },
  )
  clearAffiliateStoreForTests()
  resetTaxFormsForTests()
})

describe("GET /api/partner/tax-forms", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns 404 when the session has no affiliate account", async () => {
    const response = await request("GET", { cookie: authCookie() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("returns the partner's forms and a TIN-free W-9 draft", async () => {
    const account = linkAccount()
    const response = await request("GET", { cookie: authCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.forms).toEqual([])
    expect(body.w9).toMatchObject({
      affiliateId: account.id,
      name: USER.email,
      taxClassification: "individual",
      tinProvided: false,
    })
    expect(JSON.stringify(body.w9)).not.toMatch(/\d{3}-\d{2}-\d{4}|\d{2}-\d{7}|\b\d{9}\b/)
  })
})

describe("POST /api/partner/tax-forms", () => {
  it("rejects cross-origin requests with 403", async () => {
    linkAccount()
    const response = await request("POST", {
      cookie: authCookie(),
      origin: "https://evil.example.com",
      body: { name: "Ada" },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests with 401 and unknown accounts with 404", async () => {
    const anon = await request("POST", { body: { name: "Ada" } })
    expect(anon.status).toBe(401)

    const noAccount = await request("POST", { cookie: authCookie(), body: { name: "Ada" } })
    expect(noAccount.status).toBe(404)
  })

  it("submits W-9 details and returns the updated draft", async () => {
    linkAccount()
    const response = await request("POST", {
      cookie: authCookie(),
      body: {
        name: "Ada Lovelace",
        businessName: "Analytical Engines LLC",
        taxClassification: "llc",
        tinProvided: true,
      },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.form.status).toBe("submitted")
    expect(body.w9).toMatchObject({
      name: "Ada Lovelace",
      businessName: "Analytical Engines LLC",
      taxClassification: "llc",
      tinProvided: true,
    })
    expect(JSON.stringify(body.w9)).not.toMatch(/\d{3}-\d{2}-\d{4}/)
  })

  it("rejects TIN/SSN/EIN keys via the strict schema", async () => {
    linkAccount()
    for (const key of ["tin", "ssn", "ein", "taxId", "tax_id"]) {
      const response = await request("POST", {
        cookie: authCookie(),
        body: { name: "Ada", [key]: "123-45-6789" },
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("rejects SSN/EIN-shaped values in free-text fields", async () => {
    linkAccount()
    for (const bad of [
      { businessName: "123-45-6789" },
      { businessName: "12-3456789" },
      { name: "123456789" },
      { name: "Call 123-45-6789" },
      // Word-boundary bypasses and spaced/dotted variants.
      { name: "SSN123-45-6789" },
      { name: "123-45-6789x" },
      { businessName: "123 45 6789" },
      { businessName: "123.45.6789" },
    ]) {
      const response = await request("POST", {
        cookie: authCookie(),
        body: bad,
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
    // Nothing was persisted — the W-9 draft stays clean.
    const draft = await request("GET", { cookie: authCookie() })
    const body = await draft.json()
    expect(body.w9.name).toBe(USER.email)
    expect(body.w9.businessName).toBeUndefined()
  })

  it("returns 400 for malformed JSON", async () => {
    linkAccount()
    const response = await request("POST", {
      cookie: authCookie(),
      body: "{not json",
    })
    expect(response.status).toBe(400)
  })
})
