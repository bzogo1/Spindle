import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import { getPendingEmailChange, resetEmailChangeStoreForTests } from "@/lib/email-change"
import type { EmailChangeIdentity } from "@/lib/email-change"

const identity: EmailChangeIdentity = {
  principal: "user:u1",
  userId: "u1",
  email: "ada@lab.edu",
}

const sendAuthEmail = vi.fn()

vi.mock("@/lib/email-change", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-change")>()
  return {
    ...actual,
    resolveEmailChangeIdentity: vi.fn(async () => identity),
  }
})

vi.mock("@/lib/auth/mailer", () => ({
  authLink: (path: string) => `https://spindle.example${path}`,
  sendAuthEmail: (...args: unknown[]) => sendAuthEmail(...args),
}))

let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/email-change/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.8.8.${++ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetEmailChangeStoreForTests()
  sendAuthEmail.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/auth/email-change/request", () => {
  it("creates a pending change and emails a signed link to the new address", async () => {
    const response = await post({ newEmail: "New@Lab.edu" })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.pending.newEmail).toBe("new@lab.edu")
    expect(payload.retryAfter).toBeGreaterThan(0)

    expect(getPendingEmailChange("user:u1")?.newEmail).toBe("new@lab.edu")
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const email = sendAuthEmail.mock.calls[0][0] as {
      to: string
      linkPath: string
      subject: string
    }
    expect(email.to).toBe("new@lab.edu")
    expect(email.linkPath).toContain("/api/auth/email-change/confirm?token=")
    expect(email.subject).toContain("email")
  })

  it("enforces the per-principal resend cooldown with 429 + retryAfter", async () => {
    expect((await post({ newEmail: "a@lab.edu" })).status).toBe(200)
    const second = await post({ newEmail: "b@lab.edu" })
    expect(second.status).toBe(429)
    const payload = await second.json()
    expect(payload.code).toBe("rate_limited")
    expect(payload.retryAfter).toBeGreaterThan(0)
    expect(second.headers.get("retry-after")).toBe(String(payload.retryAfter))
    // The second request did not replace the pending change.
    expect(getPendingEmailChange("user:u1")?.newEmail).toBe("a@lab.edu")
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("rejects invalid bodies, unchanged email, and cross-origin requests", async () => {
    expect((await post({ newEmail: "nope" })).status).toBe(400)
    expect((await post({})).status).toBe(400)

    const same = await post({ newEmail: "ada@lab.edu" })
    expect(same.status).toBe(422)
    expect((await same.json()).code).toBe("invalid_email")

    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/email-change/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.8.8.99",
        },
        body: JSON.stringify({ newEmail: "x@lab.edu" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it("returns 401 when there is no session", async () => {
    const { resolveEmailChangeIdentity } = await import("@/lib/email-change")
    vi.mocked(resolveEmailChangeIdentity).mockResolvedValueOnce(null)
    const response = await post({ newEmail: "x@lab.edu" })
    expect(response.status).toBe(401)
  })
})
