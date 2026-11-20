// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import {
  getOrCreateReferralCode,
  getReferralProgramStoreForTests,
  listAttributionsForAdmin,
  resetReferralProgramStoreForTests,
  updateReferralProgramSettings,
} from "@/lib/referral-program"

import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const referredUser = {
  id: "referred-1",
  email: "referred@example.com",
  name: "Referred",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function req(path: string, init?: RequestInit, options?: { cookie?: string; origin?: string }) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.10.1.${ipCounter}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (options?.cookie) headers.cookie = `${ACCESS_COOKIE}=${options.cookie}`
  if (options?.origin) headers.origin = options.origin
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function postJson(body: unknown, options?: { cookie?: string; origin?: string }) {
  return req(
    "/api/referral/attribution",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    options,
  )
}

function authedCookie(uid = "referred-1", email = "referred@example.com") {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(referredUser)
  resetReferralProgramStoreForTests()
})

describe("POST /api/referral/attribution", () => {
  it("records an anonymous click for a known code with a uniform 200", async () => {
    const code = getOrCreateReferralCode("referrer-1")

    const response = await POST(postJson({ code: code.code }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, recorded: true })

    const { items } = listAttributionsForAdmin({})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      code: code.code,
      referrerUserId: "referrer-1",
      referredUserId: null,
      status: "pending",
      source: "click",
    })
  })

  it("ignores a client-supplied source — signup/manual cannot be forged", async () => {
    const code = getOrCreateReferralCode("referrer-1")

    for (const source of ["signup", "manual", "bogus"]) {
      const response = await POST(postJson({ code: code.code, source }))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, recorded: true })
    }

    const { items } = listAttributionsForAdmin({})
    expect(items).toHaveLength(3)
    // Every record is a "click" — nothing was recorded as signup/manual.
    for (const item of items) {
      expect(item.source).toBe("click")
      expect(item.referredUserId).toBeNull()
    }
  })

  it("returns the same 200 for unknown and malformed-pattern codes", async () => {
    getOrCreateReferralCode("referrer-1")

    for (const code of ["SPN-NOPE-0000", "garbage"]) {
      const response = await POST(postJson({ code }))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, recorded: true })
    }
    // Empty/missing code fails schema validation instead.
    const missing = await POST(postJson({}))
    expect(missing.status).toBe(400)
    expect(getReferralProgramStoreForTests().attributions).toBe(0)
  })

  it("records nothing extra when the program is disabled but still returns 200", async () => {
    const code = getOrCreateReferralCode("referrer-1")
    updateReferralProgramSettings({ enabled: false })

    const response = await POST(postJson({ code: code.code }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, recorded: true })
    expect(getReferralProgramStoreForTests().attributions).toBe(0)
  })

  it("binds referredUserId for signed-in callers and still returns 200 on self-referral", async () => {
    const code = getOrCreateReferralCode("referrer-1")

    // Signed-in referred user → bound attribution.
    const bound = await POST(postJson({ code: code.code }, { cookie: authedCookie() }))
    expect(bound.status).toBe(200)
    const afterBound = listAttributionsForAdmin({})
    expect(afterBound.items[0]?.referredUserId).toBe("referred-1")
    expect(afterBound.items[0]?.source).toBe("click")

    // Self-referral (caller owns the code) → dropped, same 200.
    getUserById.mockResolvedValue({ ...referredUser, id: "referrer-1" })
    const self = await POST(
      postJson({ code: code.code }, { cookie: authedCookie("referrer-1", "r@x.com") }),
    )
    expect(self.status).toBe(200)
    expect(await self.json()).toEqual({ ok: true, recorded: true })
    expect(listAttributionsForAdmin({}).items).toHaveLength(1) // only the earlier bound click
  })

  it("rejects malformed JSON and cross-origin requests", async () => {
    const badJson = await POST(postJson("{not json"))
    expect(badJson.status).toBe(400)

    const code = getOrCreateReferralCode("referrer-1")
    const crossOrigin = await POST(
      postJson({ code: code.code }, { origin: "https://evil.example.com" }),
    )
    expect(crossOrigin.status).toBe(403)
    expect(getReferralProgramStoreForTests().attributions).toBe(0)
  })
})
