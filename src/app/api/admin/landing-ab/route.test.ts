// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { resetLandingAbForTests } from "@/lib/landing-ab"

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
    "x-forwarded-for": `10.6.2.${ipCounter}`,
    ...(options.cookie ? { cookie: `${ACCESS_COOKIE}=${options.cookie}` } : {}),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
  }
  const req = new Request("http://localhost/api/admin/landing-ab", {
    method,
    headers,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  })
  return method === "GET" ? GET(req) : POST(req)
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

const validBody = {
  name: "referral-landing",
  variants: [
    { id: "control", weight: 50, config: { headline: "Control" } },
    { id: "treatment", weight: 50, config: { headline: "Treatment" } },
  ],
}

beforeEach(() => {
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
  resetLandingAbForTests()
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/landing-ab", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("GET")
    expect(response.status).toBe(401)
  })

  it("lists experiments for admins", async () => {
    await request("POST", validBody, { cookie: adminCookie() })
    const response = await request("GET", undefined, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.experiments).toHaveLength(1)
    expect(body.experiments[0].name).toBe("referral-landing")
  })
})

describe("POST /api/admin/landing-ab", () => {
  it("rejects cross-origin requests before auth", async () => {
    const response = await request("POST", validBody, {
      cookie: adminCookie(),
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("rejects unauthenticated requests with 401", async () => {
    const response = await request("POST", validBody)
    expect(response.status).toBe(401)
  })

  it("creates a draft experiment", async () => {
    const response = await request("POST", validBody, { cookie: adminCookie() })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.experiment.status).toBe("draft")
    expect(body.experiment.variants).toHaveLength(2)
  })
})
