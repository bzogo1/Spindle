// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetReferralProgramStoreForTests } from "@/lib/referral-program"
import { REFERRAL_CODE_PATTERN } from "@/lib/referral"

import { GET, POST } from "./route"

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

function req(path: string, init?: RequestInit, options?: { cookie?: string; origin?: string }) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.11.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (options?.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options?.origin) headers.origin = options.origin
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function postJson(body?: unknown, options?: { cookie?: string; origin?: string }) {
  return req(
    "/api/referral/program",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    options,
  )
}

function authCookie() {
  return createAccessToken({ sid: "s1", uid: "u-1", email: "user@example.com", name: "T" }).token
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(user)
  resetReferralProgramStoreForTests()
})

describe("GET /api/referral/program", () => {
  it("returns public-safe settings only for anonymous callers", async () => {
    const response = await GET(req("/api/referral/program"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.settings).toEqual({
      enabled: true,
      rewardLabel: expect.any(String),
      rewardAmountCents: null,
    })
    // No internal fields leak: no maxRewardsPerUser/windowDays, no user data.
    expect(Object.keys(body.settings).sort()).toEqual([
      "enabled",
      "rewardAmountCents",
      "rewardLabel",
    ])
    expect(body.code).toBeNull()
    expect(body.stats).toBeNull()
  })

  it("includes the caller's code and stats when signed in", async () => {
    const response = await GET(req("/api/referral/program", undefined, { cookie: authCookie() }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.settings.enabled).toBe(true)
    // GET never creates a code — null until POST.
    expect(body.code).toBeNull()
    expect(body.stats).toMatchObject({ clicks: 0, pending: 0, rewarded: 0 })
  })
})

describe("POST /api/referral/program", () => {
  it("requires same-origin and auth", async () => {
    const crossOrigin = await POST(
      postJson({}, { origin: "https://evil.example.com", cookie: authCookie() }),
    )
    expect(crossOrigin.status).toBe(403)

    const anon = await POST(postJson({}))
    expect(anon.status).toBe(401)
  })

  it("creates a referral code for the signed-in caller", async () => {
    const response = await POST(postJson({}, { cookie: authCookie() }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.code.code).toMatch(REFERRAL_CODE_PATTERN)
    expect(body.code.vanity).toBe(false)
    expect(body.stats.clicks).toBe(0)

    // Repeat call returns the same code.
    const again = await POST(postJson({}, { cookie: authCookie() }))
    expect((await again.json()).code.code).toBe(body.code.code)
  })

  it("sets a vanity code and rejects invalid/conflicting vanity input", async () => {
    const okResponse = await POST(postJson({ vanity: "my-handle" }, { cookie: authCookie() }))
    expect(okResponse.status).toBe(200)
    const body = await okResponse.json()
    expect(body.code.code).toBe("SPN-MY-HANDLE")
    expect(body.code.vanity).toBe(true)

    const tooLong = await POST(postJson({ vanity: "x".repeat(65) }, { cookie: authCookie() }))
    expect(tooLong.status).toBe(400)
  })

  it("rejects malformed JSON", async () => {
    const response = await POST(
      req(
        "/api/referral/program",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{nope",
        },
        { cookie: authCookie() },
      ),
    )
    expect(response.status).toBe(400)
  })
})
