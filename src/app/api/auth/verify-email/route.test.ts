// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"

const consumeOneTimeToken = vi.fn()
const getUserByEmail = vi.fn()
const markEmailVerified = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ consumeOneTimeToken, getUserByEmail, markEmailVerified }),
  }
})

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.6.6.${++ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  consumeOneTimeToken.mockReset()
  getUserByEmail.mockReset()
  markEmailVerified.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/auth/verify-email", () => {
  it("consumes a valid verification token and marks the email verified", async () => {
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: "ada@lab.edu", userId: "user_1" },
    })

    const response = await post({ token: "good-token" })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, verified: true })
    expect(consumeOneTimeToken).toHaveBeenCalledWith("good-token", "verify")
    expect(markEmailVerified).toHaveBeenCalledWith("user_1")
  })

  it("resolves the user by email when the token record has no userId", async () => {
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: "ada@lab.edu", userId: null },
    })
    getUserByEmail.mockResolvedValue({ id: "user_9" })

    const response = await post({ token: "good-token" })

    expect(response.status).toBe(200)
    expect(getUserByEmail).toHaveBeenCalledWith("ada@lab.edu")
    expect(markEmailVerified).toHaveBeenCalledWith("user_9")
  })

  it.each(["expired", "used", "invalid"] as const)(
    "returns 401 invalid_token with reason=%s",
    async (reason) => {
      consumeOneTimeToken.mockResolvedValue({ ok: false, reason })

      const response = await post({ token: "bad-token" })
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body).toMatchObject({ ok: false, code: "invalid_token", reason })
      expect(markEmailVerified).not.toHaveBeenCalled()
    },
  )

  it("returns 401 invalid when the token's user no longer exists", async () => {
    consumeOneTimeToken.mockResolvedValue({
      ok: true,
      record: { email: "ghost@lab.edu", userId: null },
    })
    getUserByEmail.mockResolvedValue(null)

    const response = await post({ token: "orphan-token" })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "invalid_token",
      reason: "invalid",
    })
    expect(markEmailVerified).not.toHaveBeenCalled()
  })

  it("rejects malformed bodies and cross-origin requests", async () => {
    expect((await post("not-json{")).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ token: "" })).status).toBe(400)

    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/verify-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.6.6.250",
        },
        body: JSON.stringify({ token: "good-token" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect(consumeOneTimeToken).not.toHaveBeenCalled()
  })

  it("rate-limits token guessing per IP (tokenConsume preset: 10 per 10 min)", async () => {
    consumeOneTimeToken.mockResolvedValue({ ok: false, reason: "invalid" })
    const ip = "10.6.6.200"

    for (let i = 0; i < 10; i += 1) {
      const response = await post({ token: `guess-${i}` }, { "x-forwarded-for": ip })
      expect(response.status).toBe(401)
    }

    const eleventh = await post({ token: "guess-10" }, { "x-forwarded-for": ip })
    expect(eleventh.status).toBe(429)
    expect(await eleventh.json()).toMatchObject({ ok: false, code: "rate_limited" })
  })
})
