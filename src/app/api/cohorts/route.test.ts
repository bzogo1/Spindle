import { describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"

import { GET } from "./route"

// Enable the mock-session branch of the route's session resolution; the real
// encode/decode helpers stay intact via importOriginal.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const mockSession: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function authCookie() {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid: "user-cohorts-test",
    email: "real@example.com",
    name: "Real User",
  })
  return `spindle_at=${token}`
}

function mockCookie() {
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(mockSession)}`
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/cohorts", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

describe("GET /api/cohorts", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "unauthenticated",
    })
  })

  it("rejects a malformed mock session cookie", async () => {
    const response = await get(`${MOCK_SESSION_COOKIE}=garbage`)
    expect(response.status).toBe(401)
  })

  it("returns the cohort report for a real access-token session", async () => {
    const response = await get(authCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.report).toMatchObject({
      dataSource: "demo",
      weeks: 8,
    })
    expect(Array.isArray(body.report.cohorts)).toBe(true)
    expect(body.report.cohorts.length).toBeGreaterThan(0)
    const first = body.report.cohorts[0]
    expect(first).toMatchObject({
      size: expect.any(Number),
      weekStart: expect.any(String),
      label: expect.any(String),
    })
    expect(first.cells).toHaveLength(8)
    expect(body.report.totals).toMatchObject({
      users: expect.any(Number),
      excludedUsers: expect.any(Number),
      activeThisWeek: expect.any(Number),
    })
  })

  it("returns the cohort report for a mock session cookie", async () => {
    const response = await get(mockCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.report.dataSource).toBe("demo")
  })
})
