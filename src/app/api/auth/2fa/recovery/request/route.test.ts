// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACCESS_COOKIE } from "@/lib/auth/http"
import { createAccessToken } from "@/lib/auth/token-codec"
import { listAuthEvents, setAuthAuditLogForTests } from "@/lib/auth/audit"
import { getTotpRecoveryStore, setTotpRecoveryStoreForTests } from "@/lib/auth/totp-recovery"
import { sendAuthEmail } from "@/lib/auth/mailer"
import { POST } from "./route"

const getUserById = vi.fn()
const isTotpEnabled = vi.fn()
const issueOneTimeToken = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserById, isTotpEnabled, issueOneTimeToken }),
  }
})

vi.mock("@/lib/auth/mailer", () => ({
  authLink: (path: string) => `https://app.test${path}`,
  sendAuthEmail: vi.fn().mockResolvedValue(undefined),
}))

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

let ipCounter = 0
function post(cookie?: string, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/2fa/recovery/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.1.0.${ipCounter}`,
        ...(cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : {}),
        ...headers,
      },
      body: "{}",
    }),
  )
}

beforeEach(() => {
  getUserById.mockReset().mockResolvedValue(user)
  isTotpEnabled.mockReset().mockResolvedValue(true)
  issueOneTimeToken.mockReset().mockResolvedValue("raw-token")
  vi.mocked(sendAuthEmail).mockClear()
  setTotpRecoveryStoreForTests(undefined)
  setAuthAuditLogForTests(undefined)
})

describe("POST /api/auth/2fa/recovery/request", () => {
  it("rejects unauthenticated and cross-origin requests", async () => {
    expect((await post()).status).toBe(401)
    expect((await post(accessCookie(), { origin: "https://evil.example" })).status).toBe(403)
    expect(issueOneTimeToken).not.toHaveBeenCalled()
  })

  it("rejects when 2FA is not enabled", async () => {
    isTotpEnabled.mockResolvedValue(false)
    const response = await post(accessCookie())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "totp_not_enabled" })
  })

  it("issues an email token, sends the link, and audits the request", async () => {
    const response = await post(accessCookie())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      state: "awaiting_token",
      emailSent: true,
    })

    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "verify", userId: user.id, email: user.email }),
    )
    expect(sendAuthEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user.email,
        linkPath: expect.stringContaining("/two-factor-recovery?token="),
      }),
    )

    const events = listAuthEvents({ userId: user.id })
    expect(events.map((e) => e.type)).toContain("totp.recovery.requested")
  })

  it("throttles resends within the cooldown window", async () => {
    await post(accessCookie())
    vi.mocked(sendAuthEmail).mockClear()
    issueOneTimeToken.mockClear()

    const second = await post(accessCookie())
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body).toMatchObject({ state: "awaiting_token", emailSent: false })
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
    expect(issueOneTimeToken).not.toHaveBeenCalled()
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it("reports sendFailed distinctly and does not arm the resend throttle", async () => {
    vi.mocked(sendAuthEmail).mockRejectedValueOnce(new Error("smtp down"))

    const first = await post(accessCookie())
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body).toMatchObject({
      ok: true,
      state: "awaiting_token",
      emailSent: false,
      sendFailed: true,
    })
    expect(body.retryAfterSeconds).toBeUndefined()

    // The failed send must not throttle: an immediate retry sends again.
    const second = await post(accessCookie())
    expect(await second.json()).toMatchObject({ emailSent: true })
    expect(sendAuthEmail).toHaveBeenCalledTimes(2)
  })

  it("reports an in-progress cooldown instead of duplicating it", async () => {
    const store = getTotpRecoveryStore()
    store.create({ userId: user.id, email: user.email })
    store.consumeToken(user.id)
    const cooling = store.getActive(user.id)!

    const response = await post(accessCookie())
    expect(await response.json()).toMatchObject({
      ok: true,
      state: "cooldown",
      executeAt: cooling.executeAt,
    })
    expect(issueOneTimeToken).not.toHaveBeenCalled()
  })
})
