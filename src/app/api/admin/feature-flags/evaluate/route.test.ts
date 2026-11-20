// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearFeatureFlagsForTests, createFlag } from "@/lib/feature-flags"

import { POST } from "./route"

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

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(body?: unknown, options: { cookie?: string; origin?: string } = {}) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.4.${ipCounter}`,
    "content-type": "application/json",
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return POST(
    new Request("http://localhost/api/admin/feature-flags/evaluate", {
      method: "POST",
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

const adminOpts = { cookie: cookieFor("admin@example.com", "admin-1"), origin: "http://localhost" }

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearFeatureFlagsForTests()
  createFlag({
    key: "vip",
    name: "VIP",
    enabled: true,
    targetEmails: ["vip@example.com"],
  })
  createFlag({ key: "all", name: "All", enabled: true, rolloutPercent: 100 })
  createFlag({ key: "off", name: "Off", enabled: false, rolloutPercent: 100 })
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("POST /api/admin/feature-flags/evaluate", () => {
  it("returns enabled keys for the given identity", async () => {
    const response = await request({ email: "vip@example.com" }, adminOpts)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.flags).toEqual(["all", "vip"])
  })

  it("evaluates by userId too", async () => {
    const flag = createFlag({
      key: "by-uid",
      name: "By uid",
      enabled: true,
      targetUserIds: ["u-9"],
    })
    void flag
    const response = await request({ userId: "u-9" }, adminOpts)
    const data = await response.json()
    expect(data.flags).toEqual(["all", "by-uid"])
  })

  it("rejects empty identities, bad emails, and non-admins", async () => {
    expect((await request({}, adminOpts)).status).toBe(400)
    expect((await request({ email: "nope" }, adminOpts)).status).toBe(400)
    getUserById.mockResolvedValue({ ...adminUser, id: "user-1", email: "user@example.com" })
    expect(
      (
        await request(
          { email: "a@b.co" },
          { cookie: cookieFor("user@example.com", "u1"), origin: "http://localhost" },
        )
      ).status,
    ).toBe(403)
  })
})
