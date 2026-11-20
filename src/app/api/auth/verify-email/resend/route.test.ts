import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import {
  VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS,
  verifyEmailResendCooldown,
} from "@/lib/auth/resend-cooldown"

const getUserByEmail = vi.fn()
const issueOneTimeToken = vi.fn()
const sendAuthEmail = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getUserByEmail, issueOneTimeToken }),
  }
})

vi.mock("@/lib/auth/mailer", () => ({
  authLink: (path: string) => `https://spindle.example${path}`,
  sendAuthEmail: (...args: unknown[]) => sendAuthEmail(...args),
}))

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/verify-email/resend", {
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

const unverifiedUser = {
  id: "user_1",
  email: "ada@lab.edu",
  name: "Ada",
  emailVerified: false,
  createdAt: new Date().toISOString(),
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  verifyEmailResendCooldown.reset()
  getUserByEmail.mockReset().mockResolvedValue(unverifiedUser)
  issueOneTimeToken.mockReset().mockResolvedValue("tok_123")
  sendAuthEmail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/auth/verify-email/resend", () => {
  it("sends a fresh verification link for an unverified user", async () => {
    const response = await post({ email: "ada@lab.edu" })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ ok: true, sent: true })
    // The success body carries the server cooldown so clients can sync.
    expect(payload.retryAfter).toBe(VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS)
    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "verify", email: "ada@lab.edu", userId: "user_1" }),
    )
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const email = sendAuthEmail.mock.calls[0][0] as { linkPath: string; to: string }
    expect(email.to).toBe("ada@lab.edu")
    expect(email.linkPath).toContain("/verify-email?token=")
  })

  it("returns 429 with retryAfter while the per-email cooldown is active", async () => {
    const first = await post({ email: "ada@lab.edu" })
    expect(first.status).toBe(200)

    const second = await post({ email: "ADA@lab.edu" })
    expect(second.status).toBe(429)
    const payload = await second.json()
    expect(payload).toMatchObject({ ok: false, code: "rate_limited" })
    expect(payload.retryAfter).toBeGreaterThan(0)
    expect(payload.retryAfter).toBeLessThanOrEqual(VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS)
    expect(second.headers.get("retry-after")).toBe(String(payload.retryAfter))
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    expect(issueOneTimeToken).toHaveBeenCalledTimes(1)
  })

  it("applies the cooldown uniformly so responses cannot reveal account existence", async () => {
    // Unknown address: first request looks identical to a registered one…
    getUserByEmail.mockResolvedValue(null)
    const unknownFirst = await post({ email: "nobody@lab.edu" })
    expect(unknownFirst.status).toBe(200)
    expect(await unknownFirst.json()).toMatchObject({ ok: true, sent: true })

    // …and the immediate retry is a 429 exactly like a registered address.
    const unknownSecond = await post({ email: "nobody@lab.edu" })
    expect(unknownSecond.status).toBe(429)
    expect(await unknownSecond.json()).toMatchObject({
      ok: false,
      code: "rate_limited",
    })

    // Already-verified addresses behave the same way.
    getUserByEmail.mockResolvedValue({ ...unverifiedUser, emailVerified: true })
    const verifiedFirst = await post({ email: "ada@lab.edu" })
    expect(verifiedFirst.status).toBe(200)
    expect((await post({ email: "ada@lab.edu" })).status).toBe(429)

    // No email was ever sent, yet every address consumed its cooldown slot.
    expect(sendAuthEmail).not.toHaveBeenCalled()
    expect(issueOneTimeToken).not.toHaveBeenCalled()
    expect(verifyEmailResendCooldown.remainingSeconds("nobody@lab.edu")).toBeGreaterThan(0)
    expect(verifyEmailResendCooldown.remainingSeconds("ada@lab.edu")).toBeGreaterThan(0)
  })

  it("dedupes in-flight requests: a concurrent POST during the send gets 429", async () => {
    let releaseLookup: ((user: unknown) => void) | undefined
    getUserByEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseLookup = resolve
        }),
    )

    const first = post({ email: "ada@lab.edu" })
    // Let the first request pass validation, mark the cooldown, and block
    // inside getUserByEmail.
    await flush()
    await flush()

    const second = await post({ email: "ada@lab.edu" })
    expect(second.status).toBe(429)

    releaseLookup?.(unverifiedUser)
    const firstResponse = await first
    expect(firstResponse.status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("allows the resend again once the cooldown window has passed", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    expect((await post({ email: "ada@lab.edu" })).status).toBe(200)
    expect((await post({ email: "ada@lab.edu" })).status).toBe(429)

    vi.setSystemTime(1_000_000 + (VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS + 1) * 1000)
    expect((await post({ email: "ada@lab.edu" })).status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(2)
  })

  it("does not cool down other addresses", async () => {
    await post({ email: "ada@lab.edu" })
    getUserByEmail.mockResolvedValue({ ...unverifiedUser, id: "user_2", email: "grace@lab.edu" })

    const response = await post({ email: "grace@lab.edu" })
    expect(response.status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(2)
  })

  it("responds without waiting for email delivery (no timing oracle)", async () => {
    // A send that never resolves must not hold the response open: awaiting
    // the provider call only for registered addresses would leak existence
    // through latency.
    sendAuthEmail.mockReturnValue(new Promise(() => {}))

    const response = await post({ email: "ada@lab.edu" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, sent: true })
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("still answers ok when delivery fails — the request slot stays consumed", async () => {
    sendAuthEmail.mockRejectedValue(new Error("resend down"))

    const response = await post({ email: "ada@lab.edu" })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, sent: true })
    // Rate limiting is per request, not per delivery: a retry storm is still
    // blocked even though nothing was sent.
    expect(verifyEmailResendCooldown.remainingSeconds("ada@lab.edu")).toBeGreaterThan(0)
    expect((await post({ email: "ada@lab.edu" })).status).toBe(429)
  })

  it("rejects invalid bodies and cross-origin requests", async () => {
    expect((await post({ email: "not-an-email" })).status).toBe(400)
    expect((await post({})).status).toBe(400)

    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/verify-email/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.9.9.250",
        },
        body: JSON.stringify({ email: "ada@lab.edu" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })
})
