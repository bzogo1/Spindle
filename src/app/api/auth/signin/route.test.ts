// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setAuthAuditLogForTests, listAuthEvents } from "@/lib/auth/audit"
import type { TokenPair } from "@/lib/auth/backend"
import { setSignInLockoutForTests } from "@/lib/auth/lockout"
import { getForcedResetStore, setForcedResetStoreForTests } from "@/lib/auth/forced-reset"
import { createTotpChallenge } from "@/lib/auth/token-codec"
import { MemoryLoginAlertStore, setLoginAlertStoreForTests } from "@/lib/auth/login-alerts"
import { resetNotificationHubForTests, subscribeNotificationEvents } from "@/lib/notifications/hub"
import { POST } from "./route"

const signIn = vi.fn()
const getUserByEmail = vi.fn()
const revokeSession = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ signIn, getUserByEmail, revokeSession }),
  }
})

const sessionUser = {
  id: "u1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: true,
  createdAt: new Date().toISOString(),
}

const tokens: TokenPair = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  session: {
    user: sessionUser,
    workspace: { id: "ws_ada", name: "Ada HQ", slug: "ada-hq" },
    sessionId: "s1",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
}

let store: MemoryLoginAlertStore
let ipCounter = 0

function signinRequest(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/signin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${ipCounter}`,
        "user-agent": "TestBrowser/1.0",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function credentials() {
  return { email: "ada@lab.edu", password: "correct horse" }
}

beforeEach(() => {
  signIn.mockReset().mockResolvedValue({ status: "ok", tokens })
  getUserByEmail.mockReset().mockResolvedValue(sessionUser)
  revokeSession.mockReset().mockResolvedValue(undefined)
  store = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(store)
  setAuthAuditLogForTests(undefined)
  setSignInLockoutForTests(undefined)
  setForcedResetStoreForTests(undefined)
  resetNotificationHubForTests()
})

describe("POST /api/auth/signin — login alerts", () => {
  it("creates no alert on the first sign-in but records fingerprints", async () => {
    const response = await signinRequest(credentials(), { "user-agent": "UA-A" })
    expect(response.status).toBe(200)
    expect(store.listAlerts("u1")).toEqual([])

    // A different user agent on the next sign-in is a new device.
    const second = await signinRequest(credentials(), { "user-agent": "UA-B" })
    expect(second.status).toBe(200)
    const alerts = store.listAlerts("u1")
    expect(alerts.some((a) => a.kind === "new_device")).toBe(true)
  })

  it("publishes a notification for created alerts when enabled", async () => {
    const events: unknown[] = []
    subscribeNotificationEvents(`user:${sessionUser.id}`, (event) => events.push(event))

    await signinRequest(credentials(), { "user-agent": "UA-A" })
    await signinRequest(credentials(), { "user-agent": "UA-B" })

    expect(events.length).toBeGreaterThan(0)
    const payload = (events[0] as { notification: { href?: string; category?: string } })
      .notification
    expect(payload.href).toBe("/app/security")
    expect(payload.category).toBe("security")
  })

  it("suppresses notifications when the user disabled in-app alerts", async () => {
    store.setPreferences("u1", { inAppNotifications: false })
    const events: unknown[] = []
    subscribeNotificationEvents(`user:${sessionUser.id}`, (event) => events.push(event))

    await signinRequest(credentials(), { "user-agent": "UA-A" })
    await signinRequest(credentials(), { "user-agent": "UA-B" })

    expect(events).toEqual([])
    // The alert record is still created — only delivery is suppressed.
    expect(store.listAlerts("u1").length).toBeGreaterThan(0)
  })

  it("creates a brute-force alert after repeated failures for a known email", async () => {
    signIn.mockResolvedValue({ status: "invalid" })
    for (let i = 0; i < 8; i += 1) {
      const response = await signinRequest(credentials())
      // Each request uses a fresh IP, so only the email-wide lockout (8
      // failures) can trigger — on the final attempt, which answers 429.
      expect(response.status).toBe(i < 7 ? 401 : 429)
    }
    const alerts = store.listAlerts("u1")
    expect(alerts.some((a) => a.kind === "brute_force" && a.severity === "critical")).toBe(true)
    expect(getUserByEmail).toHaveBeenCalledWith("ada@lab.edu")
  })

  it("does not create a brute-force alert for unknown emails", async () => {
    signIn.mockResolvedValue({ status: "invalid" })
    getUserByEmail.mockResolvedValue(null)
    for (let i = 0; i < 8; i += 1) {
      await signinRequest(credentials())
    }
    expect(store.listAlerts("u1")).toEqual([])
  })

  it("keeps audit events and annotates them with alert ids", async () => {
    await signinRequest(credentials(), { "user-agent": "UA-A" })
    await signinRequest(credentials(), { "user-agent": "UA-B" })

    const events = listAuthEvents({ userId: "u1", type: "signin.success" })
    expect(events.length).toBeGreaterThanOrEqual(2)
    const latest = events[0]
    expect(latest.metadata.alertKinds).toContain("new_device")
    expect((latest.metadata.alertIds as string[]).length).toBeGreaterThan(0)
  })
})

describe("POST /api/auth/signin — account lockout", () => {
  // The per-IP rate limiter (10/min) is module state shared across tests, so
  // each test gets its own source IP to stay under the limit.
  let ipOctet = 60
  function fixedIp() {
    ipOctet += 1
    return { "x-forwarded-for": `203.0.113.${ipOctet}` }
  }

  it("locks an ip+email pair after 5 failures and answers 429 + retryAfter", async () => {
    const ip = fixedIp()
    signIn.mockResolvedValue({ status: "invalid" })
    for (let i = 0; i < 4; i += 1) {
      const response = await signinRequest(credentials(), ip)
      expect(response.status).toBe(401)
    }
    const locked = await signinRequest(credentials(), ip)
    expect(locked.status).toBe(429)
    const body = await locked.json()
    expect(body).toMatchObject({ ok: false, code: "account_locked" })
    expect(body.retryAfter).toBe(15 * 60)

    // While locked the backend is never consulted again.
    const calls = signIn.mock.calls.length
    const again = await signinRequest(credentials(), ip)
    expect(again.status).toBe(429)
    expect(signIn.mock.calls.length).toBe(calls)

    // A different IP is not pair-locked (and stays under the email threshold).
    const otherIp = await signinRequest(credentials(), fixedIp())
    expect(otherIp.status).toBe(401)
  })

  it("treats unknown emails identically — same 429 envelope, no existence leak", async () => {
    const ip = fixedIp()
    signIn.mockResolvedValue({ status: "invalid" })
    getUserByEmail.mockResolvedValue(null)
    const body = { email: "ghost@nowhere.test", password: "whatever" }
    for (let i = 0; i < 5; i += 1) {
      await signinRequest(body, ip)
    }
    const locked = await signinRequest(body, ip)
    expect(locked.status).toBe(429)
    expect(await locked.json()).toMatchObject({ ok: false, code: "account_locked" })
  })

  it("resets the failure count after a successful sign-in", async () => {
    const ip = fixedIp()
    signIn.mockResolvedValue({ status: "invalid" })
    for (let i = 0; i < 4; i += 1) {
      expect((await signinRequest(credentials(), ip)).status).toBe(401)
    }
    signIn.mockResolvedValue({ status: "ok", tokens })
    expect((await signinRequest(credentials(), ip)).status).toBe(200)

    signIn.mockResolvedValue({ status: "invalid" })
    // Four fresh failures must NOT lock — the counter restarted at zero.
    for (let i = 0; i < 4; i += 1) {
      expect((await signinRequest(credentials(), ip)).status).toBe(401)
    }
  })

  it("records lockout audit events for blocked and triggering attempts", async () => {
    const ip = fixedIp()
    signIn.mockResolvedValue({ status: "invalid" })
    for (let i = 0; i < 5; i += 1) {
      await signinRequest(credentials(), ip)
    }
    await signinRequest(credentials(), ip) // blocked while locked

    const events = listAuthEvents({ email: "ada@lab.edu", type: "signin.failure" })
    const reasons = events.map((e) => e.metadata.reason)
    expect(reasons).toContain("account_locked")
    const blocked = events.find((e) => e.metadata.reason === "account_locked")
    expect(typeof blocked?.metadata.retryAfterSeconds).toBe("number")
    const triggered = events.find((e) => e.metadata.lockoutTriggered === true)
    expect(triggered).toBeDefined()
  })
})

describe("POST /api/auth/signin — forced password reset", () => {
  it("refuses a session with 403 password_reset_required when the flag is set", async () => {
    getForcedResetStore().require(sessionUser.id, { setBy: "admin@lab.edu" })

    const response = await signinRequest(credentials())
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, code: "password_reset_required" })
    // No session payload and no auth cookies are issued.
    expect(body.session).toBeUndefined()
    expect(response.headers.get("set-cookie")).toBeNull()

    const events = listAuthEvents({ userId: sessionUser.id, type: "signin.failure" })
    expect(events[0]?.metadata.reason).toBe("password_reset_required")
  })

  it("revokes the session the backend minted for a flagged sign-in", async () => {
    getForcedResetStore().require(sessionUser.id)

    const response = await signinRequest(credentials())
    expect(response.status).toBe(403)
    // The just-minted session must not be left orphaned in the store.
    expect(revokeSession).toHaveBeenCalledWith(tokens.refreshToken)
  })

  it("still refuses the sign-in when session revocation fails", async () => {
    getForcedResetStore().require(sessionUser.id)
    revokeSession.mockRejectedValue(new Error("backend down"))

    const response = await signinRequest(credentials())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "password_reset_required",
    })
  })

  it("still issues a session once the flag is cleared", async () => {
    const store = getForcedResetStore()
    store.require(sessionUser.id)
    store.clear(sessionUser.id)

    const response = await signinRequest(credentials())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, status: "ok" })
  })

  it("does not reveal the flag for wrong passwords", async () => {
    getForcedResetStore().require(sessionUser.id)
    signIn.mockResolvedValue({ status: "invalid" })

    const response = await signinRequest(credentials())
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_credentials" })
  })

  it("withholds the TOTP challenge for a flagged account", async () => {
    signIn.mockResolvedValue({
      status: "totp_required",
      challenge: createTotpChallenge(sessionUser.id).token,
    })
    getForcedResetStore().require(sessionUser.id)

    const response = await signinRequest(credentials())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "password_reset_required",
    })
  })

  it("still returns the TOTP challenge when the flag is not set", async () => {
    const challenge = createTotpChallenge(sessionUser.id).token
    signIn.mockResolvedValue({ status: "totp_required", challenge })

    const response = await signinRequest(credentials())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "totp_required",
      challenge,
    })
  })
})
