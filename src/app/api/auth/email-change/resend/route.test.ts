import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"
import {
  getPendingEmailChange,
  requestEmailChange,
  resetEmailChangeStoreForTests,
  type EmailChangeIdentity,
} from "@/lib/email-change"

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

function post(headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/email-change/resend", {
      method: "POST",
      headers: { "x-forwarded-for": `10.5.5.${++ipCounter}`, ...headers },
    }),
  )
}

beforeEach(() => {
  resetEmailChangeStoreForTests()
  sendAuthEmail.mockReset().mockResolvedValue(undefined)
  vi.clearAllMocks()
})

describe("POST /api/auth/email-change/resend", () => {
  it("404s when there is no pending change", async () => {
    const response = await post()
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe("no_pending")
  })

  it("emails a fresh link and rotates the pending id (old links die)", async () => {
    const first = requestEmailChange(identity, "new@lab.edu")
    if (!first.ok) throw new Error("setup failed")
    const oldId = first.pending.id

    const response = await post()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.pending.newEmail).toBe("new@lab.edu")
    expect(payload.retryAfter).toBeGreaterThan(0)

    expect(getPendingEmailChange("user:u1")?.id).not.toBe(oldId)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    expect((sendAuthEmail.mock.calls[0][0] as { to: string }).to).toBe("new@lab.edu")
  })

  it("enforces the shared cooldown with 429 + retryAfter", async () => {
    requestEmailChange(identity, "new@lab.edu")
    expect((await post()).status).toBe(200)
    const second = await post()
    expect(second.status).toBe(429)
    expect((await second.json()).code).toBe("rate_limited")
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it("rejects cross-origin requests", async () => {
    requestEmailChange(identity, "new@lab.edu")
    const response = await post({ origin: "https://evil.example" })
    expect(response.status).toBe(403)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })
})
