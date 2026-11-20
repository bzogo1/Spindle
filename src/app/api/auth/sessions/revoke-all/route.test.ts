// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { listAuthEvents, setAuthAuditLogForTests } from "@/lib/auth/audit"
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { POST } from "./route"

const getUserById = vi.fn()
const revokeAllSessions = vi.fn()
const refreshSession = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, revokeAllSessions, refreshSession }),
  }
})

const user = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

function accessCookie(uid = user.id) {
  return createAccessToken({ sid: "s1", uid, email: user.email, name: user.name }).token
}

function post(cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ")
  return POST(
    new Request("http://localhost/api/auth/sessions/revoke-all", {
      method: "POST",
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...headers,
      },
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockImplementation(async (id: string) => ({ ...user, id }))
  revokeAllSessions.mockReset().mockResolvedValue(undefined)
  refreshSession.mockReset().mockResolvedValue(null)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/sessions/revoke-all", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await post()
    expect(response.status).toBe(401)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })

  it("rejects cross-origin requests", async () => {
    const response = await post(
      { [ACCESS_COOKIE]: accessCookie() },
      { origin: "https://evil.example" },
    )
    expect(response.status).toBe(403)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })

  it("revokes all sessions for the caller and clears auth cookies", async () => {
    const response = await post({ [ACCESS_COOKIE]: accessCookie() })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, revoked: true })
    expect(revokeAllSessions).toHaveBeenCalledWith(user.id)

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${ACCESS_COOKIE}=`)
    expect(setCookie).toContain(`${REFRESH_COOKIE}=`)
    expect(setCookie).toContain("Max-Age=0")
  })

  it("records a session.revoked audit event", async () => {
    await post({ [ACCESS_COOKIE]: accessCookie() })
    const events = listAuthEvents({ type: "session.revoked", userId: user.id })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      userId: user.id,
      email: user.email,
      metadata: { scope: "all" },
    })
  })

  it("falls back to the refresh cookie when the access token is missing", async () => {
    refreshSession.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      session: {
        user,
        workspace: null,
        sessionId: "s2",
        expiresAt: new Date().toISOString(),
      },
    })

    const response = await post({ [REFRESH_COOKIE]: "opaque-refresh" })
    expect(response.status).toBe(200)
    expect(refreshSession).toHaveBeenCalledWith("opaque-refresh")
    expect(revokeAllSessions).toHaveBeenCalledWith(user.id)
  })

  it("clears auth cookies when the user no longer exists", async () => {
    getUserById.mockResolvedValue(null)

    const response = await post({ [ACCESS_COOKIE]: accessCookie() })
    expect(response.status).toBe(401)
    expect(revokeAllSessions).not.toHaveBeenCalled()

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${ACCESS_COOKIE}=`)
    expect(setCookie).toContain(`${REFRESH_COOKIE}=`)
    expect(setCookie).toContain("Max-Age=0")
  })

  it("returns 401 when the refresh token is also invalid", async () => {
    refreshSession.mockResolvedValue(null)
    const response = await post({ [REFRESH_COOKIE]: "stale" })
    expect(response.status).toBe(401)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })
})
