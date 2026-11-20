// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

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

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u-1",
  email: "user@example.com",
  name: "User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function req(path: string, cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.20.1.${ipCounter}`,
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return new Request(`http://localhost${path}`, { headers })
}

function authCookie() {
  return createAccessToken({ sid: "s1", uid: "u-1", email: "user@example.com", name: "T" }).token
}

/** Seeds a qualified attribution for `u-1`'s code and issues its reward. */
function seedRewardForCaller() {
  const code = getOrCreateReferralCode("u-1")
  const result = recordAttribution({
    code: code.code,
    source: "manual",
    referredUserId: null,
  })
  if (!result.recorded) throw new Error(`attribution not recorded: ${result.reason}`)
  qualifyAttribution(result.attribution.id)
  return issueRewardForAttribution(result.attribution.id)
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(user)
  resetReferralProgramStoreForTests()
  resetReferralRewardsStoreForTests()
})

describe("GET /api/referral/rewards", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await GET(req("/api/referral/rewards"))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.code).toBe("unauthenticated")
  })

  it("returns the caller's rewards and the program reward label", async () => {
    const reward = seedRewardForCaller()

    const response = await GET(req("/api/referral/rewards", authCookie()))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.rewardLabel).toBe("A free month of Spindle Pro")
    expect(body.total).toBe(1)
    expect(body.rewards).toHaveLength(1)
    expect(body.rewards[0]).toMatchObject({
      id: reward.id,
      referrerUserId: "u-1",
      status: "issued",
      type: "credit",
    })
  })

  it("does not leak other users' rewards", async () => {
    seedRewardForCaller()
    const other = getOrCreateReferralCode("u-2")
    const result = recordAttribution({
      code: other.code,
      source: "manual",
      referredUserId: null,
    })
    if (!result.recorded) throw new Error("record failed")
    qualifyAttribution(result.attribution.id)
    issueRewardForAttribution(result.attribution.id)

    const response = await GET(req("/api/referral/rewards", authCookie()))
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.rewards[0].referrerUserId).toBe("u-1")
  })

  it("honours status/type filters and pagination params", async () => {
    seedRewardForCaller()

    const issued = await GET(req("/api/referral/rewards?status=issued", authCookie()))
    expect((await issued.json()).total).toBe(1)

    const revoked = await GET(req("/api/referral/rewards?status=revoked", authCookie()))
    expect((await revoked.json()).total).toBe(0)

    const badge = await GET(req("/api/referral/rewards?type=badge", authCookie()))
    expect((await badge.json()).total).toBe(0)

    const page = await GET(req("/api/referral/rewards?limit=1&offset=0", authCookie()))
    expect((await page.json()).rewards).toHaveLength(1)
  })

  it("rejects invalid filter and pagination params with 400", async () => {
    const badStatus = await GET(req("/api/referral/rewards?status=bogus", authCookie()))
    expect(badStatus.status).toBe(400)

    const badType = await GET(req("/api/referral/rewards?type=cash", authCookie()))
    expect(badType.status).toBe(400)

    const badLimit = await GET(req("/api/referral/rewards?limit=abc", authCookie()))
    expect(badLimit.status).toBe(400)
  })
})
