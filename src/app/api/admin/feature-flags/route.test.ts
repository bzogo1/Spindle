// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { clearFeatureFlagsForTests } from "@/lib/feature-flags"

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

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function request(
  method: "GET" | "POST",
  body?: unknown,
  options: { cookie?: string; origin?: string } = {},
) {
  ipCounter += 1
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.7.1.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  return (method === "GET" ? GET : POST)(
    new Request("http://localhost/api/admin/feature-flags", {
      method,
      headers,
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    }),
  )
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

const VALID_BODY = {
  key: "new-dashboard",
  name: "New dashboard",
  description: "Experimental shell",
  enabled: true,
  rolloutPercent: 25,
  targetUserIds: ["user-1"],
  targetEmails: ["VIP@Example.com"],
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  clearFeatureFlagsForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/feature-flags", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("rejects non-admin users with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "user-1", email: "user@example.com" })
    const response = await request("GET", undefined, {
      cookie: cookieFor("user@example.com", "user-1"),
    })
    expect(response.status).toBe(403)
  })

  it("lists flags for admins", async () => {
    await POST(
      new Request("http://localhost/api/admin/feature-flags", {
        method: "POST",
        headers: {
          "x-forwarded-for": "10.7.1.250",
          "content-type": "application/json",
          cookie: `${ACCESS_COOKIE}=${adminCookie()}`,
          origin: "http://localhost",
        },
        body: JSON.stringify(VALID_BODY),
      }),
    )
    const response = await request("GET", undefined, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.flags).toHaveLength(1)
    expect(data.flags[0].key).toBe("new-dashboard")
    // Emails are normalized to lowercase by the store.
    expect(data.flags[0].targetEmails).toEqual(["vip@example.com"])
  })
})

describe("POST /api/admin/feature-flags", () => {
  it("creates a flag with defaults applied", async () => {
    const response = await request(
      "POST",
      { key: "k", name: "Flag" },
      {
        cookie: adminCookie(),
        origin: "http://localhost",
      },
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.flag.key).toBe("k")
    expect(data.flag.enabled).toBe(false)
  })

  it("rejects invalid bodies and duplicate keys", async () => {
    const bad = await request(
      "POST",
      { key: "bad key!", name: "x" },
      {
        cookie: adminCookie(),
        origin: "http://localhost",
      },
    )
    expect(bad.status).toBe(400)

    await request("POST", VALID_BODY, { cookie: adminCookie(), origin: "http://localhost" })
    const dup = await request("POST", VALID_BODY, {
      cookie: adminCookie(),
      origin: "http://localhost",
    })
    expect(dup.status).toBe(400)
  })

  it("rejects cross-origin posts", async () => {
    const response = await request("POST", VALID_BODY, {
      cookie: adminCookie(),
      origin: "https://evil.example",
    })
    expect(response.status).toBe(403)
  })
})
