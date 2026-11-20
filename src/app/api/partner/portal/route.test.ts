// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyForAffiliate,
  approveAffiliate,
  clearAffiliateStoreForTests,
  suspendAffiliate,
} from "@/lib/affiliate"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  PARTNER_PAYOUT_LABEL_MAX,
  PARTNER_PROFILES_STORE_MAX,
  clearPartnerPortalStoreForTests,
  createPartnerAnnouncement,
  updatePartnerProfile,
} from "@/lib/partner-portal"

import { GET, PATCH } from "./route"

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
  method: "GET" | "PATCH",
  options: { cookie?: string; origin?: string; body?: unknown } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.7.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : PATCH)(
    new Request("http://localhost/api/partner/portal", {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }
        : {}),
    }),
  )
}

function authCookie() {
  return createAccessToken({ sid: "s1", uid: USER.id, email: USER.email, name: "T" }).token
}

async function activeAccount() {
  const account = applyForAffiliate(USER.id, USER.email)
  approveAffiliate(account.id)
  return account
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(USER)
  clearAffiliateStoreForTests()
  clearPartnerPortalStoreForTests()
})

describe("GET /api/partner/portal", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns 404 when the caller never applied", async () => {
    const response = await request("GET", { cookie: authCookie() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, code: "not_found" })
  })

  it("returns 403 with a generic message for non-active accounts", async () => {
    const pending = applyForAffiliate(USER.id, USER.email)
    const pendingResponse = await request("GET", { cookie: authCookie() })
    expect(pendingResponse.status).toBe(403)

    approveAffiliate(pending.id)
    suspendAffiliate(pending.id)
    const suspendedResponse = await request("GET", { cookie: authCookie() })
    expect(suspendedResponse.status).toBe(403)

    const body = await suspendedResponse.json()
    expect(body.code).toBe("forbidden")
    // Generic message — does not leak the affiliate status.
    expect(body.message).not.toContain("suspended")
  })

  it("returns portal data for an active partner", async () => {
    const account = await activeAccount()

    const response = await request("GET", { cookie: authCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.portal.affiliate).toMatchObject({
      id: account.id,
      status: "active",
      code: account.code,
    })
    expect(body.portal.stats).toMatchObject({ clicks: 0, conversions: 0 })
    expect(body.portal.sharePath).toBe(`/api/affiliate/click/${account.code}`)
    expect(body.portal.profile).toBeNull()
    expect(body.portal.announcements).toEqual([])
    expect(body.portal.links).toEqual([])
  })

  it("returns announcements visible to active partners", async () => {
    await activeAccount()
    createPartnerAnnouncement({ title: "All partners", body: "b" })
    createPartnerAnnouncement({ title: "Active only", body: "b", audience: "active" })

    const response = await request("GET", { cookie: authCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.portal.announcements.map((a: { title: string }) => a.title).sort()).toEqual([
      "Active only",
      "All partners",
    ])
  })
})

describe("PATCH /api/partner/portal", () => {
  it("updates allowed profile fields for an active partner", async () => {
    await activeAccount()

    const response = await request("PATCH", {
      cookie: authCookie(),
      body: { payoutMethodLabel: "PayPal", taxInfoStatus: "submitted" },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.profile).toMatchObject({
      payoutMethodLabel: "PayPal",
      taxInfoStatus: "submitted",
    })
  })

  it("rejects sensitive/unknown fields entirely", async () => {
    await activeAccount()

    for (const body of [
      { bankAccountNumber: "123" },
      { ssn: "000-00-0000" },
      { taxId: "12-3456789" },
      { routingNumber: "021000021" },
    ]) {
      const response = await request("PATCH", { cookie: authCookie(), body })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
    }
  })

  it("rejects an oversized payout method label with 400", async () => {
    await activeAccount()

    const response = await request("PATCH", {
      cookie: authCookie(),
      body: { payoutMethodLabel: "x".repeat(PARTNER_PAYOUT_LABEL_MAX + 1) },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("returns 503 (not 400) when the profile store is at capacity", async () => {
    await activeAccount()
    // Fill the bounded profile store with other affiliates so the active
    // partner's first profile write hits the capacity guard.
    for (let i = 0; i < PARTNER_PROFILES_STORE_MAX; i += 1) {
      updatePartnerProfile(`aff_fill_${i}`, {})
    }

    const response = await request("PATCH", {
      cookie: authCookie(),
      body: { taxInfoStatus: "submitted" },
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, code: "unavailable" })
  })

  it("rejects non-active partners and cross-origin requests", async () => {
    applyForAffiliate(USER.id, USER.email) // pending

    const forbidden = await request("PATCH", {
      cookie: authCookie(),
      body: { taxInfoStatus: "submitted" },
    })
    expect(forbidden.status).toBe(403)

    const account = applyForAffiliate("other-user", "other@example.com")
    approveAffiliate(account.id)
    const crossOrigin = await request("PATCH", {
      cookie: authCookie(),
      origin: "https://evil.example.com",
      body: { taxInfoStatus: "submitted" },
    })
    expect(crossOrigin.status).toBe(403)
  })
})
