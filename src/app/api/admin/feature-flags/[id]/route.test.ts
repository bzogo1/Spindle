// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearFeatureFlagsForTests, createFlag, isFeatureEnabled } from "@/lib/feature-flags"

import { DELETE, GET, PATCH } from "./route"

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

type Method = "GET" | "PATCH" | "DELETE"
const handlers = { GET, PATCH, DELETE }

function request(
  method: Method,
  id: string,
  body?: unknown,
  options: { cookie?: string; origin?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.2.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return handlers[method](
    new Request(`http://localhost/api/admin/feature-flags/${id}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    }),
    { params: Promise.resolve({ id }) },
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")
const adminOpts = { cookie: adminCookie(), origin: "http://localhost" }

let flagId = ""

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearFeatureFlagsForTests()
  flagId = createFlag({
    key: "editable",
    name: "Editable",
    enabled: true,
    rolloutPercent: 10,
    targetUserIds: ["u-target"],
  }).id
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/feature-flags/[id]", () => {
  it("returns one flag and 404s for unknown ids", async () => {
    const okRes = await request("GET", flagId, undefined, adminOpts)
    expect(okRes.status).toBe(200)
    const data = await okRes.json()
    expect(data.flag.id).toBe(flagId)

    const missing = await request("GET", "ff_missing", undefined, adminOpts)
    expect(missing.status).toBe(404)
  })

  it("requires admin", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "user-1", email: "user@example.com" })
    const res = await request("GET", flagId, undefined, {
      cookie: cookieFor("user@example.com", "user-1"),
    })
    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/admin/feature-flags/[id]", () => {
  it("updates fields and clears optional ones with null", async () => {
    const res = await request(
      "PATCH",
      flagId,
      { enabled: false, rolloutPercent: null, targetUserIds: null, name: "Renamed" },
      adminOpts,
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.flag.name).toBe("Renamed")
    expect(data.flag.enabled).toBe(false)
    expect(data.flag.rolloutPercent).toBeUndefined()
    expect(data.flag.targetUserIds).toBeUndefined()
    expect(isFeatureEnabled("editable", { userId: "u-target" })).toBe(false)
  })

  it("rejects empty patches and unknown ids", async () => {
    const empty = await request("PATCH", flagId, {}, adminOpts)
    expect(empty.status).toBe(400)

    const missing = await request("PATCH", "ff_missing", { enabled: true }, adminOpts)
    expect(missing.status).toBe(404)
  })

  it("rejects invalid rolloutPercent", async () => {
    const res = await request("PATCH", flagId, { rolloutPercent: 150 }, adminOpts)
    expect(res.status).toBe(400)
  })
})

describe("DELETE /api/admin/feature-flags/[id]", () => {
  it("deletes the flag", async () => {
    const res = await request("DELETE", flagId, undefined, adminOpts)
    expect(res.status).toBe(200)
    expect(isFeatureEnabled("editable", { userId: "u-target" })).toBe(false)
    const again = await request("DELETE", flagId, undefined, adminOpts)
    expect(again.status).toBe(404)
  })
})
