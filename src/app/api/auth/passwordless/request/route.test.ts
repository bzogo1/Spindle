import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { passwordlessRequestCooldown } from "@/app/api/auth/passwordless/cooldown"
import { POST } from "./route"

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

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/passwordless/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.8.8.${++ipCounter}`,
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  passwordlessRequestCooldown.reset()
  getUserByEmail.mockReset().mockResolvedValue(user)
  issueOneTimeToken.mockReset().mockResolvedValue("tok_123")
  sendAuthEmail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/auth/passwordless/request", () => {
  it("embeds a sanitized next path in the magic-link URL", async () => {
    const response = await post({
      email: "ada@lab.edu",
      purpose: "signin",
      next: "/dashboard/files?folder=lab",
    })

    expect(response.status).toBe(200)
    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magic", email: "ada@lab.edu" }),
    )
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const email = sendAuthEmail.mock.calls[0][0] as { linkPath: string; text: string }
    expect(email.linkPath).toBe(
      `/magic-link?token=${encodeURIComponent("tok_123")}&next=${encodeURIComponent("/dashboard/files?folder=lab")}`,
    )
    expect(email.text).toContain("next=")
  })

  it("omits next from the link when it is not a safe app path", async () => {
    // Includes "/\evil.example": URL parsers treat "\" as "/", so the naive
    // prefix check would let it navigate off-site.
    const unsafe = ["//evil.example", "https://evil.example", "dashboard", "/\\evil.example"]
    for (const [index, next] of unsafe.entries()) {
      const response = await post({ email: `ada${index}@lab.edu`, purpose: "signin", next })
      expect(response.status).toBe(200)
    }

    expect(sendAuthEmail).toHaveBeenCalledTimes(4)
    for (const call of sendAuthEmail.mock.calls) {
      const email = call[0] as { linkPath: string }
      expect(email.linkPath).toBe(`/magic-link?token=${encodeURIComponent("tok_123")}`)
    }
  })

  it("still answers ok for unknown emails without sending", async () => {
    getUserByEmail.mockResolvedValue(null)
    const response = await post({ email: "nobody@lab.edu", purpose: "signin" })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it("uses the configured magic-link TTL for the token and the email copy", async () => {
    vi.stubEnv("MAGIC_LINK_TTL_MINUTES", "30")
    const response = await post({ email: "ada@lab.edu", purpose: "signin" })

    expect(response.status).toBe(200)
    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magic", ttlMs: 30 * 60 * 1000 }),
    )
    const email = sendAuthEmail.mock.calls[0][0] as { text: string; html: string }
    expect(email.text).toContain("expires in 30 minutes")
    expect(email.html).toContain("30 minutes")
  })

  it("falls back to the default TTL when the env override is invalid", async () => {
    vi.stubEnv("MAGIC_LINK_TTL_MINUTES", "not-a-number")
    const response = await post({ email: "ada@lab.edu", purpose: "signin" })

    expect(response.status).toBe(200)
    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "magic", ttlMs: 15 * 60 * 1000 }),
    )
  })

  it("rate-limits repeat requests for the same email with retryAfter", async () => {
    const first = await post({ email: "ada@lab.edu", purpose: "signin" })
    expect(first.status).toBe(200)

    const second = await post({ email: "ada@lab.edu", purpose: "signin" })
    expect(second.status).toBe(429)
    const body = await second.json()
    expect(body).toMatchObject({ ok: false, code: "rate_limited" })
    expect(body.retryAfter).toBeGreaterThan(0)
    expect(second.headers.get("retry-after")).toBe(String(body.retryAfter))
    // Only the first request reached the backend/mailer.
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("dedupes in-flight requests: a concurrent POST during the send gets 429", async () => {
    let releaseLookup: ((user: unknown) => void) | undefined
    getUserByEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseLookup = resolve
        }),
    )

    const first = post({ email: "ada@lab.edu", purpose: "signin" })
    // Let the first request pass validation, mark the cooldown, and block
    // inside getUserByEmail.
    await flush()
    await flush()

    const second = await post({ email: "ada@lab.edu", purpose: "signin" })
    expect(second.status).toBe(429)
    expect(await second.json()).toMatchObject({ ok: false, code: "rate_limited" })

    releaseLookup?.(user)
    const firstResponse = await first
    expect(firstResponse.status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("applies the per-email cooldown identically to unknown addresses", async () => {
    getUserByEmail.mockResolvedValue(null)

    const first = await post({ email: "nobody@lab.edu", purpose: "signin" })
    expect(first.status).toBe(200)
    const second = await post({ email: "nobody@lab.edu", purpose: "signin" })
    expect(second.status).toBe(429)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it("does not cooldown-limit a different email address", async () => {
    await post({ email: "ada@lab.edu", purpose: "signin" })
    const other = await post({ email: "grace@lab.edu", purpose: "signin" })
    expect(other.status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(2)
  })
})
