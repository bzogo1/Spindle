// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import { MemoryLoginAlertStore, setLoginAlertStoreForTests } from "@/lib/auth/login-alerts"

const consumeOneTimeToken = vi.fn()
const getUserById = vi.fn()
const createSessionForUser = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ consumeOneTimeToken, getUserById, createSessionForUser }),
  }
})

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/passwordless/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.9.9.${++ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

const user = {
  id: "user_1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const sessionTokens = {
  accessToken: "at_123",
  refreshToken: "rt_123",
  session: {
    user,
    workspace: null,
    sessionId: "sess_1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
}

let alertStore: MemoryLoginAlertStore

beforeEach(() => {
  consumeOneTimeToken.mockReset()
  getUserById.mockReset().mockResolvedValue(user)
  createSessionForUser.mockReset().mockResolvedValue(sessionTokens)
  alertStore = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(alertStore)
})

describe("POST /api/auth/passwordless/verify", () => {
  it("consumes a valid magic token and sets the auth cookies", async () => {
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: user.email, userId: user.id },
    })

    const response = await post({ token: "good-token" })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(consumeOneTimeToken).toHaveBeenCalledWith("good-token", "magic")
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("spindle_at=at_123")
    expect(setCookie).toContain("spindle_rt=rt_123")
    // Session-establishing responses must not be cached.
    expect(response.headers.get("cache-control")).toBe("no-store")
    // Cookies are httpOnly + SameSite=Lax (Secure only in production).
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=lax")
  })

  it("reports reason=expired for an expired token", async () => {
    consumeOneTimeToken.mockResolvedValue({ ok: false, reason: "expired" })

    const response = await post({ token: "old-token" })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({
      ok: false,
      code: "invalid_token",
      reason: "expired",
      message: "This sign-in link has expired.",
    })
    expect(createSessionForUser).not.toHaveBeenCalled()
  })

  it("reports reason=used for an already-consumed token", async () => {
    consumeOneTimeToken.mockResolvedValue({ ok: false, reason: "used" })

    const response = await post({ token: "used-token" })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ ok: false, code: "invalid_token", reason: "used" })
  })

  it("reports reason=invalid for an unknown token", async () => {
    consumeOneTimeToken.mockResolvedValue({ ok: false, reason: "invalid" })

    const response = await post({ token: "bogus" })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ ok: false, code: "invalid_token", reason: "invalid" })
  })

  it("rejects a token whose user no longer exists", async () => {
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: user.email, userId: "ghost" },
    })
    getUserById.mockResolvedValue(null)

    const response = await post({ token: "orphan-token" })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ ok: false, code: "invalid_token", reason: "invalid" })
    expect(createSessionForUser).not.toHaveBeenCalled()
  })

  it("records login-alert fingerprints for the magic-link sign-in", async () => {
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: user.email, userId: user.id },
    })

    // Failed token consumption is not a sign-in: nothing recorded.
    consumeOneTimeToken.mockResolvedValueOnce({ ok: false, reason: "invalid" })
    expect((await post({ token: "bad" })).status).toBe(401)
    expect(alertStore.listAlerts(user.id)).toEqual([])

    // First success seeds fingerprints silently; a new device alerts.
    expect((await post({ token: "good-1" }, { "user-agent": "UA-A" })).status).toBe(200)
    expect(alertStore.listAlerts(user.id)).toEqual([])
    expect((await post({ token: "good-2" }, { "user-agent": "UA-B" })).status).toBe(200)
    expect(alertStore.listAlerts(user.id).map((a) => a.kind)).toContain("new_device")
  })
})
