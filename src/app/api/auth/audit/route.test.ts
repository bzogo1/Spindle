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

function get(query = "", cookie?: string) {
  return GET(
    new Request(`http://localhost/api/auth/audit${query}`, {
      headers: cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {},
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  setAuthAuditLogForTests(new MemoryAuthAuditLog(50))
})

describe("GET /api/auth/audit", () => {
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
    recordAuthEvent({ type: "signin.success", userId: "u1", email: "ada@lab.edu" })
    recordAuthEvent({ type: "logout", userId: "u1", email: "ada@lab.edu" })
    recordAuthEvent({ type: "signin.success", userId: "u2", email: "bob@lab.edu" })

    const response = await get("", accessCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.limit).toBe(50)
    expect(body.events).toHaveLength(2)
    expect(body.events.map((event: { type: string }) => event.type)).toEqual([
      "logout",
      "signin.success",
    ])
    for (const event of body.events) {
      expect(event).toMatchObject({ userId: "u1", email: "ada@lab.edu" })
      expect(event).toHaveProperty("timestamp")
      expect(event).toHaveProperty("ip")
      expect(event).toHaveProperty("userAgent")
      expect(event).toHaveProperty("metadata")
    }
  })

  it("honors the limit query param and clamps it", async () => {
    for (let i = 0; i < 5; i += 1) {
      recordAuthEvent({ type: "logout", userId: "u1" })
    }

    const limited = await get("?limit=2", accessCookie())
    expect((await limited.json()).events).toHaveLength(2)

    const clamped = await get("?limit=9999", accessCookie())
    const body = await clamped.json()
    expect(body.limit).toBe(200)
    expect(body.events).toHaveLength(5)

    const fallback = await get("?limit=abc", accessCookie())
    expect((await fallback.json()).events).toHaveLength(5)
  })
})
