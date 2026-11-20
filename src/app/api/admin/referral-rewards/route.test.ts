// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  flagAttributionFraud,
  getOrCreateReferralCode,
  qualifyAttribution,
  recordAttribution,
  resetReferralProgramStoreForTests,
  updateReferralProgramSettings,
} from "@/lib/referral-program"
import {
  issueRewardForAttribution,
  resetReferralRewardsStoreForTests,
  revokeReward,
} from "@/lib/referral-rewards"

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

const plainUser = {
  id: "u-9",
  email: "user@example.com",
  name: "User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function req(path: string, init?: RequestInit, options?: { cookie?: string; origin?: string }) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.30.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (options?.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options?.origin) headers.origin = options.origin
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function postJson(body: unknown, options?: { cookie?: string; origin?: string }) {
  return req(
    "/api/admin/referral-rewards",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  )
}

function cookieFor(email: string, uid: string) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const userCookie = () => cookieFor("user@example.com", "u-9")

/** Records + qualifies an attribution for `referrerUserId`'s code. */
function qualifiedAttribution(referrerUserId = "referrer-1") {
  const code = getOrCreateReferralCode(referrerUserId)
  const result = recordAttribution({
    code: code.code,
    source: "manual",
    referredUserId: null,
  })
  if (!result.recorded) throw new Error(`attribution not recorded: ${result.reason}`)
  return qualifyAttribution(result.attribution.id)
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetReferralProgramStoreForTests()
  resetReferralRewardsStoreForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/referral-rewards", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/admin/referral-rewards"))
    expect(response.status).toBe(401)
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue(plainUser)
    const response = await GET(
      req("/api/admin/referral-rewards", undefined, { cookie: userCookie() }),
    )
    expect(response.status).toBe(403)
  })

  it("lists rewards across referrers for an admin", async () => {
    const attribution = qualifiedAttribution("referrer-1")
    const attribution2 = qualifiedAttribution("referrer-2")
    const r1 = issueRewardForAttribution(attribution.id)
    issueRewardForAttribution(attribution2.id)

    const response = await GET(
      req("/api/admin/referral-rewards", undefined, { cookie: adminCookie() }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.total).toBe(2)
    expect(body.rewards).toHaveLength(2)
    expect(body.stats).toMatchObject({ total: 2, issued: 2, revoked: 0 })
    expect(body.rewardLabel).toBe("A free month of Spindle Pro")
    expect(body.rewards.map((r: { id: string }) => r.id)).toContain(r1.id)
  })

  it("filters by status/type/referrerUserId/attributionId and paginates", async () => {
    const attribution = qualifiedAttribution("referrer-1")
    const r1 = issueRewardForAttribution(attribution.id, { type: "badge" })
    revokeReward(r1.id)

    const revoked = await GET(
      req("/api/admin/referral-rewards?status=revoked", undefined, {
        cookie: adminCookie(),
      }),
    )
    expect((await revoked.json()).total).toBe(1)

    const badges = await GET(
      req("/api/admin/referral-rewards?type=badge", undefined, {
        cookie: adminCookie(),
      }),
    )
    expect((await badges.json()).total).toBe(1)

    const scoped = await GET(
      req("/api/admin/referral-rewards?referrerUserId=referrer-1", undefined, {
        cookie: adminCookie(),
      }),
    )
    expect((await scoped.json()).total).toBe(1)

    const byAttribution = await GET(
      req(`/api/admin/referral-rewards?attributionId=${attribution.id}`, undefined, {
        cookie: adminCookie(),
      }),
    )
    expect((await byAttribution.json()).total).toBe(1)

    const page = await GET(
      req("/api/admin/referral-rewards?limit=1&offset=1", undefined, {
        cookie: adminCookie(),
      }),
    )
    expect((await page.json()).rewards).toHaveLength(0)

    const badStatus = await GET(
      req("/api/admin/referral-rewards?status=bogus", undefined, {
        cookie: adminCookie(),
      }),
    )
    expect(badStatus.status).toBe(400)

    const badLimit = await GET(
      req("/api/admin/referral-rewards?limit=abc", undefined, {
        cookie: adminCookie(),
      }),
    )
    expect(badLimit.status).toBe(400)
  })
})

describe("POST /api/admin/referral-rewards", () => {
  it("rejects cross-origin, unauthenticated, and non-admin requests", async () => {
    const crossOrigin = await POST(
      postJson({ attributionId: "rfa_x" }, { origin: "https://evil.example.com" }),
    )
    expect(crossOrigin.status).toBe(403)

    const anon = await POST(postJson({ attributionId: "rfa_x" }))
    expect(anon.status).toBe(401)

    getUserById.mockResolvedValue(plainUser)
    const nonAdmin = await POST(postJson({ attributionId: "rfa_x" }, { cookie: userCookie() }))
    expect(nonAdmin.status).toBe(403)
  })

  it("issues a reward for a qualified attribution", async () => {
    const attribution = qualifiedAttribution("referrer-1")

    const response = await POST(
      postJson(
        { attributionId: attribution.id, type: "badge", reason: "nice" },
        { cookie: adminCookie() },
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.reward).toMatchObject({
      attributionId: attribution.id,
      referrerUserId: "referrer-1",
      type: "badge",
      status: "issued",
      reason: "nice",
    })
  })

  it("returns 404 for an unknown attribution", async () => {
    const response = await POST(
      postJson({ attributionId: "rfa_missing" }, { cookie: adminCookie() }),
    )
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe("not_found")
  })

  it("returns 409 on double-issue for the same attribution", async () => {
    const attribution = qualifiedAttribution("referrer-1")
    await POST(postJson({ attributionId: attribution.id }, { cookie: adminCookie() }))

    const again = await POST(postJson({ attributionId: attribution.id }, { cookie: adminCookie() }))
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe("conflict")
  })

  it("returns 403 for a fraud-flagged attribution", async () => {
    const attribution = qualifiedAttribution("referrer-1")
    flagAttributionFraud(attribution.id)

    const response = await POST(
      postJson({ attributionId: attribution.id }, { cookie: adminCookie() }),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe("fraud_flagged")
  })

  it("returns 409 (not 503) when maxRewardsPerUser is reached", async () => {
    updateReferralProgramSettings({ maxRewardsPerUser: 1 })
    const first = qualifiedAttribution("referrer-1")
    await POST(postJson({ attributionId: first.id }, { cookie: adminCookie() }))

    const second = qualifiedAttribution("referrer-1")
    const response = await POST(postJson({ attributionId: second.id }, { cookie: adminCookie() }))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("limit")
  })

  it("returns 400 for malformed bodies and invalid fields", async () => {
    const malformed = new Request("http://localhost/api/admin/referral-rewards", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
      },
      body: "{nope",
    })
    expect((await POST(malformed)).status).toBe(400)

    const empty = await POST(postJson({}, { cookie: adminCookie() }))
    expect(empty.status).toBe(400)

    const badType = await POST(
      postJson({ attributionId: "rfa_x", type: "cash" }, { cookie: adminCookie() }),
    )
    expect(badType.status).toBe(400)

    const badAmount = await POST(
      postJson({ attributionId: "rfa_x", amountCents: -1 }, { cookie: adminCookie() }),
    )
    expect(badAmount.status).toBe(400)
  })
})
