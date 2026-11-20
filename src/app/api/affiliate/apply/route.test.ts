// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { clearAffiliateStoreForTests, getAffiliateByUserId } from "@/lib/affiliate"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { POST } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const USER = {
  id: "user-1",
  email: "affiliate@example.com",
  name: "Affiliate",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function post(options: { cookie?: string; origin?: string; body?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.1.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
  }
  return POST(
    new Request("http://localhost/api/affiliate/apply", {
      method: "POST",
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    }),
  )
}

function authCookie(uid = USER.id, email = USER.email) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(USER)
  clearAffiliateStoreForTests()
})

describe("POST /api/affiliate/apply", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await post()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("rejects cross-origin requests with 403", async () => {
    const response = await post({
      cookie: authCookie(),
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("creates a pending affiliate application for the caller", async () => {
    const response = await post({ cookie: authCookie() })
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.affiliate).toMatchObject({
      userId: USER.id,
      email: USER.email,
      status: "pending",
      commissionRatePct: 20,
    })
    expect(body.affiliate.code).toMatch(/^AFF-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(getAffiliateByUserId(USER.id)?.id).toBe(body.affiliate.id)
  })

  it("returns 409 on a duplicate application", async () => {
    await post({ cookie: authCookie() })
    const response = await post({ cookie: authCookie() })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, code: "conflict" })
  })

  it("returns 400 for a malformed JSON body", async () => {
    const response = await post({ cookie: authCookie(), body: "{not json" })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })
})
