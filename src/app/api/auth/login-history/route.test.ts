// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MemoryAuthAuditLog, recordAuthEvent, setAuthAuditLogForTests } from "@/lib/auth/audit"
import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { GET } from "./route"

const getUserById = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function accessCookie(uid = user.id, email = user.email) {
  return createAccessToken({ sid: "s1", uid, email, name: user.name }).token
}

let ipCounter = 0

function get(query = "", cookie?: string, ip?: string) {
  ipCounter += 1
  // A distinct x-forwarded-for per call keeps the module-level rate limiter
  // from leaking budget between tests; tests that exercise 429 pass `ip`.
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = `${ACCESS_COOKIE}=${cookie}`
  headers["x-forwarded-for"] = ip ?? `10.0.0.${ipCounter}`
  return GET(new Request(`http://localhost/api/auth/login-history${query}`, { headers }))
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setAuthAuditLogForTests(new MemoryAuthAuditLog(200))
})

describe("GET /api/auth/login-history", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(getUserById).not.toHaveBeenCalled()
  })

  it("rejects a token whose user no longer exists", async () => {
    getUserById.mockResolvedValue(null)
    const response = await get("", accessCookie())
    expect(response.status).toBe(401)
  })

  it("returns only the signed-in user's events, newest first", async () => {
    recordAuthEvent({ type: "signin.success", userId: "u1", email: "ada@lab.edu", ip: "1.2.3.4" })
    recordAuthEvent({ type: "logout", userId: "u1", email: "ada@lab.edu" })
    recordAuthEvent({ type: "signin.success", userId: "u2", email: "bob@lab.edu" })
    recordAuthEvent({ type: "signin.failure", userId: null, email: "ghost@lab.edu" })

    const response = await get("", accessCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
    expect(body.total).toBe(2)
    expect(body.hasMore).toBe(false)
    expect(body.events).toHaveLength(2)
    expect(body.events.map((event: { type: string }) => event.type)).toEqual([
      "logout",
      "signin.success",
    ])
    for (const event of body.events) {
      expect(event).toMatchObject({ userId: "u1", email: "ada@lab.edu" })
    }
    expect(body.events[1].ip).toBe("1.2.3.4")
  })

  it("filters by event type", async () => {
    recordAuthEvent({ type: "signin.success", userId: "u1" })
    recordAuthEvent({ type: "signin.failure", userId: "u1" })
    recordAuthEvent({ type: "signin.failure", userId: "u2" })

    const response = await get("?type=signin.failure", accessCookie())
    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({ type: "signin.failure", userId: "u1" })
  })

  it("rejects an unknown event type", async () => {
    const response = await get("?type=nonsense", accessCookie())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_request" })
  })

  it("filters by date range (date-only params are UTC day bounds)", async () => {
    const store = new MemoryAuthAuditLog(200)
    setAuthAuditLogForTests(store)
    // The store stamps `new Date()` at record time, so fake timers are the
    // cleanest way to place events on different days.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z"))
      store.record({ type: "signin.success", userId: "u1" })
      vi.setSystemTime(new Date("2026-01-12T12:00:00.000Z"))
      store.record({ type: "logout", userId: "u1" })
      vi.setSystemTime(new Date("2026-01-20T12:00:00.000Z"))
      store.record({ type: "token.refresh", userId: "u1" })
    } finally {
      vi.useRealTimers()
    }

    const range = await get("?from=2026-01-11&to=2026-01-15", accessCookie())
    const body = await range.json()
    expect(body.total).toBe(1)
    expect(body.events[0].type).toBe("logout")

    const fromOnly = await get("?from=2026-01-19", accessCookie())
    expect((await fromOnly.json()).events.map((e: { type: string }) => e.type)).toEqual([
      "token.refresh",
    ])
  })

  it("rejects malformed dates and inverted ranges", async () => {
    expect((await get("?from=not-a-date", accessCookie())).status).toBe(400)
    expect((await get("?from=2026-02-01&to=2026-01-01", accessCookie())).status).toBe(400)
  })

  it("paginates with limit and offset", async () => {
    for (let i = 0; i < 5; i += 1) {
      recordAuthEvent({ type: "logout", userId: "u1" })
    }

    const first = await get("?limit=2&offset=0", accessCookie())
    const firstBody = await first.json()
    expect(firstBody.events).toHaveLength(2)
    expect(firstBody.total).toBe(5)
    expect(firstBody.hasMore).toBe(true)

    const second = await get("?limit=2&offset=2", accessCookie())
    const secondBody = await second.json()
    expect(secondBody.events).toHaveLength(2)
    expect(secondBody.offset).toBe(2)
    expect(secondBody.hasMore).toBe(true)

    const last = await get("?limit=2&offset=4", accessCookie())
    const lastBody = await last.json()
    expect(lastBody.events).toHaveLength(1)
    expect(lastBody.hasMore).toBe(false)
  })

  it("clamps limit and rejects invalid paging params", async () => {
    recordAuthEvent({ type: "logout", userId: "u1" })

    const clamped = await get("?limit=9999", accessCookie())
    expect((await clamped.json()).limit).toBe(200)

    expect((await get("?limit=abc", accessCookie())).status).toBe(400)
    expect((await get("?offset=-1", accessCookie())).status).toBe(400)
    // Partial-numeric values must not be silently truncated by parseInt.
    expect((await get("?limit=50abc", accessCookie())).status).toBe(400)
    expect((await get("?limit=10.5", accessCookie())).status).toBe(400)
    expect((await get("?offset=2abc", accessCookie())).status).toBe(400)
    expect((await get("?offset=+3", accessCookie())).status).toBe(400)
    expect((await get("?limit=", accessCookie())).status).toBe(400)
  })

  it("rate limits repeated requests per IP", async () => {
    const ip = "203.0.113.99"
    const cookie = accessCookie()
    let lastStatus = 0
    // AUTH_LIMITS.publicRead allows 60 requests per window.
    for (let i = 0; i < 61; i += 1) {
      const response = await get("", cookie, ip)
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
