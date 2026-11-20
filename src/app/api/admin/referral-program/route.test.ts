// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  getOrCreateReferralCode,
  getReferralProgramSettings,
  recordAttribution,
  resetReferralProgramStoreForTests,
} from "@/lib/referral-program"

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

const plainUser = {
  id: "u-9",
  email: "user@example.com",
  name: "User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function req(path: string, init?: RequestInit, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.12.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function patchJson(body: unknown, options?: { cookie?: string; origin?: string }) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (options?.origin) headers.origin = options.origin
  if (options?.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  return new Request("http://localhost/api/admin/referral-program", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  })
}

function cookieFor(email: string, uid: string) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const userCookie = () => cookieFor("user@example.com", "u-9")

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetReferralProgramStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/referral-program", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/admin/referral-program"))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue(plainUser)
    const response = await GET(req("/api/admin/referral-program", undefined, userCookie()))
    expect(response.status).toBe(403)
  })

  it("returns settings, stats, and attributions for an admin", async () => {
    const code = getOrCreateReferralCode("referrer-1")
    recordAttribution({ code: code.code, source: "signup", referredUserId: "u-1" })

    const response = await GET(req("/api/admin/referral-program", undefined, adminCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.settings).toEqual(getReferralProgramSettings())
    expect(body.stats.totals.clicks).toBe(1)
    expect(body.stats.totals.pending).toBe(1)
    expect(body.total).toBe(1)
    expect(body.attributions).toHaveLength(1)
    expect(body.attributions[0]).toMatchObject({
      code: code.code,
      source: "signup",
      referredUserId: "u-1",
      status: "pending",
    })
  })

  it("filters attributions by status and paginates", async () => {
    const code = getOrCreateReferralCode("referrer-1")
    const result = recordAttribution({
      code: code.code,
      source: "signup",
      referredUserId: "u-1",
    })
    if (!result.recorded) throw new Error("expected recorded attribution")
    // A second pending click — both records filter under status=pending.
    recordAttribution({ code: code.code, source: "click" })

    const pending = await GET(
      req("/api/admin/referral-program?status=pending", undefined, adminCookie()),
    )
    expect((await pending.json()).total).toBe(2)

    const bogus = await GET(
      req("/api/admin/referral-program?status=bogus", undefined, adminCookie()),
    )
    expect(bogus.status).toBe(400)

    const badLimit = await GET(
      req("/api/admin/referral-program?limit=abc", undefined, adminCookie()),
    )
    expect(badLimit.status).toBe(400)
  })
})

describe("PATCH /api/admin/referral-program", () => {
  it("rejects cross-origin, unauthenticated, and non-admin requests", async () => {
    const crossOrigin = await PATCH(
      patchJson({ enabled: false }, { origin: "https://evil.example.com" }),
    )
    expect(crossOrigin.status).toBe(403)

    const anon = await PATCH(patchJson({ enabled: false }))
    expect(anon.status).toBe(401)

    getUserById.mockResolvedValue(plainUser)
    const nonAdmin = await PATCH(patchJson({ enabled: false }, { cookie: userCookie() }))
    expect(nonAdmin.status).toBe(403)
  })

  it("updates settings for an admin", async () => {
    const response = await PATCH(
      patchJson(
        { enabled: false, rewardLabel: "Nope", maxRewardsPerUser: 5 },
        { cookie: adminCookie() },
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.settings).toMatchObject({
      enabled: false,
      rewardLabel: "Nope",
      maxRewardsPerUser: 5,
    })
    expect(getReferralProgramSettings().enabled).toBe(false)
  })

  it("rejects invalid patches", async () => {
    // Empty patch.
    const empty = await PATCH(patchJson({}, { cookie: adminCookie() }))
    expect(empty.status).toBe(400)

    // Out-of-range value.
    const bad = await PATCH(patchJson({ windowDays: 99999 }, { cookie: adminCookie() }))
    expect(bad.status).toBe(400)

    // Wrong type.
    const wrongType = await PATCH(patchJson({ enabled: "yes" }, { cookie: adminCookie() }))
    expect(wrongType.status).toBe(400)

    // Malformed JSON.
    const malformed = new Request("http://localhost/api/admin/referral-program", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
      },
      body: "{nope",
    })
    expect((await PATCH(malformed)).status).toBe(400)
  })
})
