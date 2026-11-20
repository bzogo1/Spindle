// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import type { ChurnScore } from "@/lib/churn"

import { GET } from "./route"

const mocks = vi.hoisted(() => ({
  scoreAllUsers: vi.fn(),
}))

vi.mock("@/lib/churn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/churn")>()
  return { ...actual, scoreAllUsers: mocks.scoreAllUsers }
})

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

function score(overrides: Partial<ChurnScore>): ChurnScore {
  return {
    userId: "u1",
    email: "user@example.com",
    name: null,
    risk: "low",
    score: 10,
    factors: [{ signal: "recency", impact: 0, detail: "Active." }],
    computedAt: "2026-06-15T12:00:00.000Z",
    ...overrides,
  }
}

const SCORES: ChurnScore[] = [
  score({ userId: "u-high", email: "high@example.com", risk: "high", score: 80 }),
  score({ userId: "u-med", email: "med@example.com", risk: "medium", score: 45 }),
  score({ userId: "u-low", email: "low@example.com", risk: "low", score: 5 }),
]

function cookieFor(email: string, uid = `uid-${email}`) {
  return createAccessToken({ sid: "s1", uid, email, name: "T" }).token
}

let ipCounter = 0

function get(query = "", cookie?: string) {
  ipCounter += 1
  const headers: Record<string, string> = { "x-forwarded-for": `10.10.0.${ipCounter}` }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request(`http://localhost/api/admin/churn${query}`, { headers }))
}

const adminCookie = () => cookieFor("admin@example.com", "admin-1")

beforeEach(() => {
  mocks.scoreAllUsers.mockReset()
  mocks.scoreAllUsers.mockResolvedValue(SCORES)
  getUserById.mockReset()
  getUserById.mockResolvedValue(adminUser)
  setAdminEmailsForTests(["admin@example.com"])
})

afterEach(() => {
  setAdminEmailsForTests(null)
})

describe("GET /api/admin/churn", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(mocks.scoreAllUsers).not.toHaveBeenCalled()
  })

  it("rejects a signed-in non-admin with 403", async () => {
    getUserById.mockResolvedValue({ ...adminUser, id: "u9", email: "user@example.com" })
    const response = await get("", cookieFor("user@example.com", "u9"))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "forbidden" })
    expect(mocks.scoreAllUsers).not.toHaveBeenCalled()
  })

  it("returns all scores for an admin with default params", async () => {
    const response = await get("", adminCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.method).toBe("heuristic")
    expect(body.total).toBe(3)
    expect(body.returned).toBe(3)
    expect(body.scores.map((s: ChurnScore) => s.userId)).toEqual(["u-high", "u-med", "u-low"])
  })

  it("filters by minRisk", async () => {
    const response = await get("?minRisk=medium", adminCookie())
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.scores.map((s: ChurnScore) => s.risk)).toEqual(["high", "medium"])
  })

  it("rejects an invalid minRisk", async () => {
    const response = await get("?minRisk=severe", adminCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("clamps limit and rejects out-of-range values", async () => {
    const okResponse = await get("?limit=1", adminCookie())
    const okBody = await okResponse.json()
    expect(okBody.returned).toBe(1)
    expect(okBody.total).toBe(3)

    const badResponse = await get("?limit=0", adminCookie())
    expect(badResponse.status).toBe(400)
    const tooBig = await get("?limit=501", adminCookie())
    expect(tooBig.status).toBe(400)
  })

  it("returns 500 when scoring fails", async () => {
    mocks.scoreAllUsers.mockRejectedValue(new Error("boom"))
    const response = await get("", adminCookie())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ ok: false, code: "internal" })
  })
})
