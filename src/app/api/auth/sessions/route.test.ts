// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET } from "./route"

const getUserById = vi.fn()
const listSessions = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, listSessions }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const sessions = [
  {
    id: "s-current",
    createdAt: "2025-01-02T10:00:00.000Z",
    expiresAt: "2025-02-01T10:00:00.000Z",
  },
  {
    id: "s-other",
    createdAt: "2025-01-01T09:00:00.000Z",
    expiresAt: "2025-01-31T09:00:00.000Z",
  },
]

function accessCookie(uid = user.id, sid = "s-current") {
  return createAccessToken({ sid, uid, email: user.email, name: user.name }).token
}

let ipCounter = 0

function get(cookie?: string, ip?: string) {
  ipCounter += 1
  // A distinct x-forwarded-for per call keeps the module-level rate limiter
  // from leaking budget between tests; tests that exercise 429 pass `ip`.
  const headers: Record<string, string> = {
    "x-forwarded-for": ip ?? `10.0.0.${ipCounter}`,
  }
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  return GET(new Request("http://localhost/api/auth/sessions", { headers }))
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  listSessions.mockReset().mockResolvedValue(sessions)
})

describe("GET /api/auth/sessions", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
    expect(listSessions).not.toHaveBeenCalled()
  })

  it("rejects requests whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get(accessCookie())
    expect(response.status).toBe(401)
    expect(listSessions).not.toHaveBeenCalled()
  })

  it("returns the caller's sessions with the current session id", async () => {
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      sessions,
      currentSessionId: "s-current",
      supported: true,
    })
    expect(getUserById).toHaveBeenCalledWith(user.id)
    expect(listSessions).toHaveBeenCalledWith(user.id)
  })

  it("marks whichever session the access token belongs to as current", async () => {
    const response = await get(accessCookie(user.id, "s-other"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ currentSessionId: "s-other" })
  })

  it("returns an empty list when the user has no active sessions", async () => {
    listSessions.mockResolvedValue([])
    const response = await get(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sessions: [] })
  })

  it("rate limits repeated requests per IP", async () => {
    const ip = "203.0.113.99"
    const cookie = accessCookie()
    let lastStatus = 0
    // AUTH_LIMITS.publicRead allows 60 requests per window.
    for (let i = 0; i < 61; i += 1) {
      const response = await get(cookie, ip)
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
