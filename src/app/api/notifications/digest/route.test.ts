import { beforeEach, describe, expect, it, vi } from "vitest"

const sendNotificationDigest = vi.fn()
const isDigestDue = vi.fn()

vi.mock("@/lib/notifications/digest", () => ({
  sendNotificationDigest: (...args: unknown[]) => sendNotificationDigest(...args),
  isDigestDue: (...args: unknown[]) => isDigestDue(...args),
}))

import { createAccessToken } from "@/lib/auth/token-codec"

import { POST } from "./route"

const EMAIL = "digest-user@example.com"

function authCookie() {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid: "user-digest",
    email: EMAIL,
    name: "Digest",
  })
  return `spindle_at=${token}`
}

function post(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/notifications/digest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

const validBody = {
  frequency: "daily",
  notifications: [{ title: "Run finished", category: "agent" }],
  preferences: { email: true, categories: { agent: { email: true } } },
}

beforeEach(() => {
  sendNotificationDigest.mockReset()
  sendNotificationDigest.mockResolvedValue({
    delivery: "sent",
    itemCount: 1,
    overflowCount: 0,
  })
  isDigestDue.mockReset()
  isDigestDue.mockReturnValue(true)
})

describe("POST /api/notifications/digest", () => {
  it("rejects cross-origin requests before auth or parsing", async () => {
    const response = await post(validBody, authCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
    expect(sendNotificationDigest).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated requests", async () => {
    const response = await post(validBody)
    expect(response.status).toBe(401)
    expect(sendNotificationDigest).not.toHaveBeenCalled()
  })

  it("rejects malformed bodies", async () => {
    const response = await post({ frequency: "hourly" }, authCookie())
    expect(response.status).toBe(400)
    expect(sendNotificationDigest).not.toHaveBeenCalled()
  })

  it("sends to the session email, never a body-supplied address", async () => {
    const response = await post({ ...validBody, to: "attacker@example.com" }, authCookie())
    expect(response.status).toBe(200)
    expect(sendNotificationDigest).toHaveBeenCalledTimes(1)
    const input = sendNotificationDigest.mock.calls[0][0] as { to: string }
    expect(input.to).toBe(EMAIL)
  })

  it("short-circuits when lastSentAt says the cadence has not elapsed", async () => {
    isDigestDue.mockReturnValue(false)
    const response = await post(
      { ...validBody, lastSentAt: new Date().toISOString() },
      authCookie(),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toMatchObject({ ok: true, delivery: "not-due" })
    expect(sendNotificationDigest).not.toHaveBeenCalled()
  })

  it("returns the digest result on success", async () => {
    const response = await post(validBody, authCookie())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toMatchObject({ ok: true, delivery: "sent", itemCount: 1 })
  })

  it("maps provider failures to 502", async () => {
    sendNotificationDigest.mockRejectedValue(new Error("resend down"))
    const response = await post(validBody, authCookie())
    expect(response.status).toBe(502)
  })
})
