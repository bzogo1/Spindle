// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import {
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
  passwordResetRequestCooldown,
} from "@/lib/auth-endpoint-rate-limit"

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
    new Request("http://localhost/api/auth/password/reset/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.7.7.${++ipCounter}`,
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

beforeEach(() => {
  passwordResetRequestCooldown.reset()
  getUserByEmail.mockReset().mockResolvedValue(user)
  issueOneTimeToken.mockReset().mockResolvedValue("tok_reset")
  sendAuthEmail.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/auth/password/reset/request", () => {
  it("emails a single-use reset link for a registered address", async () => {
    const response = await post({ email: "ada@lab.edu" })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, sent: true })
    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reset", email: "ada@lab.edu", userId: "user_1" }),
    )
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const email = sendAuthEmail.mock.calls[0][0] as { to: string; linkPath: string }
    expect(email.to).toBe("ada@lab.edu")
    expect(email.linkPath).toContain("/reset-password/")
  })

  it("answers ok for unknown addresses without sending", async () => {
    getUserByEmail.mockResolvedValue(null)

    const response = await post({ email: "nobody@lab.edu" })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, sent: true })
    expect(issueOneTimeToken).not.toHaveBeenCalled()
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it("rate-limits repeat requests for the same email with retryAfter", async () => {
    expect((await post({ email: "ada@lab.edu" })).status).toBe(200)

    const second = await post({ email: "ADA@lab.edu" })
    expect(second.status).toBe(429)
    const body = await second.json()
    expect(body).toMatchObject({ ok: false, code: "rate_limited" })
    expect(body.retryAfter).toBeGreaterThan(0)
    expect(body.retryAfter).toBeLessThanOrEqual(PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS)
    expect(second.headers.get("retry-after")).toBe(String(body.retryAfter))
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("applies the per-email cooldown uniformly so responses cannot reveal account existence", async () => {
    // Unknown address gets the identical 429 on immediate retry.
    getUserByEmail.mockResolvedValue(null)
    expect((await post({ email: "nobody@lab.edu" })).status).toBe(200)
    expect((await post({ email: "nobody@lab.edu" })).status).toBe(429)

    // A different address is unaffected.
    getUserByEmail.mockResolvedValue(user)
    const other = await post({ email: "grace@lab.edu" })
    expect(other.status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("per-IP emailSend limiter throttles bursts across distinct addresses", async () => {
    // 5 requests per 10 minutes per IP; each uses a fresh email so only the
    // IP bucket is exercised.
    const ip = "10.7.7.250"
    for (let i = 0; i < 5; i += 1) {
      const response = await post({ email: `user${i}@lab.edu` }, { "x-forwarded-for": ip })
      expect(response.status).toBe(200)
    }

    const sixth = await post({ email: "user5@lab.edu" }, { "x-forwarded-for": ip })
    expect(sixth.status).toBe(429)
    expect(await sixth.json()).toMatchObject({ ok: false, code: "rate_limited" })
  })

  it("rejects invalid bodies and cross-origin requests", async () => {
    expect((await post({ email: "not-an-email" })).status).toBe(400)
    expect((await post({})).status).toBe(400)

    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/password/reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.7.7.251",
        },
        body: JSON.stringify({ email: "ada@lab.edu" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })
})
