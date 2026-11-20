// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  getOrCreateReferralCode,
  qualifyAttribution,
  recordAttribution,
  resetReferralProgramStoreForTests,
} from "@/lib/referral-program"
import {
  issueRewardForAttribution,
  resetReferralRewardsStoreForTests,
} from "@/lib/referral-rewards"

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

function req(path: string, init?: RequestInit, options?: { cookie?: string; origin?: string }) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.40.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (options?.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options?.origin) headers.origin = options.origin
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function patchJson(id: string, body: unknown, options?: { cookie?: string; origin?: string }) {
  return req(
    `/api/admin/referral-rewards/${id}`,
    {
      method: "PATCH",
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
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function seedReward() {
  const code = getOrCreateReferralCode("referrer-1")
  const result = recordAttribution({
    code: code.code,
    source: "manual",
    referredUserId: null,
  })
  if (!result.recorded) throw new Error("record failed")
  const attribution = qualifyAttribution(result.attribution.id)
  return issueRewardForAttribution(attribution.id)
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

describe("GET /api/admin/referral-rewards/[id]", () => {
  it("returns one reward for an admin", async () => {
    const reward = seedReward()
    const response = await GET(
      req(`/api/admin/referral-rewards/${reward.id}`, undefined, {
        cookie: adminCookie(),
      }),
      ctx(reward.id),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.reward).toMatchObject({
      id: reward.id,
      status: "issued",
      referrerUserId: "referrer-1",
    })
  })

  it("404s for unknown ids", async () => {
    const response = await GET(
      req("/api/admin/referral-rewards/rfr_missing", undefined, {
        cookie: adminCookie(),
      }),
      ctx("rfr_missing"),
    )
    expect(response.status).toBe(404)
  })

  it("rejects unauthenticated and non-admin requests", async () => {
    const reward = seedReward()

    const anon = await GET(req(`/api/admin/referral-rewards/${reward.id}`), ctx(reward.id))
    expect(anon.status).toBe(401)

    getUserById.mockResolvedValue(plainUser)
    const nonAdmin = await GET(
      req(`/api/admin/referral-rewards/${reward.id}`, undefined, {
        cookie: userCookie(),
      }),
      ctx(reward.id),
    )
    expect(nonAdmin.status).toBe(403)
  })
})

describe("PATCH /api/admin/referral-rewards/[id]", () => {
  it("rejects cross-origin, unauthenticated, and non-admin requests", async () => {
    const reward = seedReward()

    const crossOrigin = await PATCH(
      patchJson(reward.id, { action: "revoke" }, { origin: "https://evil.example.com" }),
      ctx(reward.id),
    )
    expect(crossOrigin.status).toBe(403)

    const anon = await PATCH(patchJson(reward.id, { action: "revoke" }), ctx(reward.id))
    expect(anon.status).toBe(401)

    getUserById.mockResolvedValue(plainUser)
    const nonAdmin = await PATCH(
      patchJson(reward.id, { action: "revoke" }, { cookie: userCookie() }),
      ctx(reward.id),
    )
    expect(nonAdmin.status).toBe(403)
  })

  it("revokes an issued reward with a reason", async () => {
    const reward = seedReward()
    const response = await PATCH(
      patchJson(
        reward.id,
        { action: "revoke", reason: "fraud confirmed" },
        { cookie: adminCookie() },
      ),
      ctx(reward.id),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.reward).toMatchObject({
      id: reward.id,
      status: "revoked",
      reason: "fraud confirmed",
    })
    expect(body.reward.revokedAt).toBeTruthy()
  })

  it("returns 409 when revoking an already-revoked reward", async () => {
    const reward = seedReward()
    await PATCH(
      patchJson(reward.id, { action: "revoke" }, { cookie: adminCookie() }),
      ctx(reward.id),
    )
    const again = await PATCH(
      patchJson(reward.id, { action: "revoke" }, { cookie: adminCookie() }),
      ctx(reward.id),
    )
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe("invalid_transition")
  })

  it("404s for unknown ids", async () => {
    const response = await PATCH(
      patchJson("rfr_missing", { action: "revoke" }, { cookie: adminCookie() }),
      ctx("rfr_missing"),
    )
    expect(response.status).toBe(404)
  })

  it("returns 400 for malformed bodies and invalid actions", async () => {
    const reward = seedReward()

    const malformed = new Request(`http://localhost/api/admin/referral-rewards/${reward.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
      },
      body: "{nope",
    })
    expect((await PATCH(malformed, ctx(reward.id))).status).toBe(400)

    const badAction = await PATCH(
      patchJson(reward.id, { action: "issue" }, { cookie: adminCookie() }),
      ctx(reward.id),
    )
    expect(badAction.status).toBe(400)

    const empty = await PATCH(patchJson(reward.id, {}, { cookie: adminCookie() }), ctx(reward.id))
    expect(empty.status).toBe(400)
  })
})
