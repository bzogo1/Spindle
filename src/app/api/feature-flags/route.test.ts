// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearFeatureFlagsForTests, createFlag, updateFlag } from "@/lib/feature-flags"

import { GET } from "./route"

const getUserById = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const caller = {
  id: "user-1",
  email: "caller@example.com",
  name: "Caller",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function cookieFor(uid: string) {
  return createAccessToken({ sid: "s1", uid, email: caller.email, name: "T" }).token
}

let ipCounter = 0

function request(options: { cookie?: string } = {}) {
  ipCounter += 1
  return GET(
    new Request("http://localhost/api/feature-flags", {
      headers: {
        "x-forwarded-for": `10.7.3.${ipCounter}`,
        ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
      },
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(caller)
  clearFeatureFlagsForTests()
})

afterEach(() => {
  clearFeatureFlagsForTests()
})

describe("GET /api/feature-flags", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request()
    expect(response.status).toBe(401)
  })

  it("returns enabled flag keys matching the caller's targets", async () => {
    createFlag({
      key: "targeted",
      name: "Targeted",
      enabled: true,
      targetUserIds: ["user-1"],
    })
    createFlag({
      key: "email-targeted",
      name: "Email targeted",
      enabled: true,
      targetEmails: ["caller@example.com"],
    })
    createFlag({ key: "off", name: "Off", enabled: false, rolloutPercent: 100 })
    createFlag({ key: "everyone", name: "Everyone", enabled: true, rolloutPercent: 100 })

    const response = await request({ cookie: cookieFor("user-1") })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.flags).toEqual(["email-targeted", "everyone", "targeted"])
  })

  it("does not leak flags the caller does not match", async () => {
    const flag = createFlag({
      key: "vip-only",
      name: "VIP",
      enabled: true,
      targetUserIds: ["someone-else"],
    })
    updateFlag(flag.id, { rolloutPercent: 0 })

    const response = await request({ cookie: cookieFor("user-1") })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.flags).toEqual([])
  })
})
