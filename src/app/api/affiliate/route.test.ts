// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyForAffiliate,
  approveAffiliate,
  clearAffiliateStoreForTests,
  recordClick,
  recordConversion,
} from "@/lib/affiliate"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const USER = {
  id: "user-get",
  email: "status@example.com",
  name: "Status",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

let ipCounter = 0

function get(cookie?: string) {
  ipCounter += 1
  return GET(
    new Request("http://localhost/api/affiliate", {
      headers: {
        "x-forwarded-for": `10.8.2.${ipCounter}`,
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
      },
    }),
  )
}

function authCookie() {
  return createAccessToken({ sid: "s1", uid: USER.id, email: USER.email, name: "T" }).token
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(USER)
  clearAffiliateStoreForTests()
})

describe("GET /api/affiliate", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns affiliate: null before applying", async () => {
    const response = await get(authCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      affiliate: null,
      stats: null,
      sharePath: null,
    })
  })

  it("returns the caller's account, stats, and share path", async () => {
    const account = applyForAffiliate(USER.id, USER.email)
    approveAffiliate(account.id)
    recordClick(account.code)
    recordConversion(account.code, { amountCents: 1000 })

    const response = await get(authCookie())
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.affiliate).toMatchObject({
      id: account.id,
      status: "active",
      code: account.code,
    })
    expect(body.stats).toEqual({
      clicks: 1,
      conversions: 1,
      revenueCents: 1000,
      commissionCents: 200,
    })
    expect(body.sharePath).toBe(`/api/affiliate/click/${account.code}`)
  })
})
