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

vi.mock("@/lib/email-change", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-change")>()
  return {
    ...actual,
    resolveEmailChangeIdentity: vi.fn(async () => identity),
  }
})

let ipCounter = 0

function post(headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/email-change/cancel", {
      method: "POST",
      headers: { "x-forwarded-for": `10.6.6.${++ipCounter}`, ...headers },
    }),
  )
}

beforeEach(() => {
  resetEmailChangeStoreForTests()
  vi.clearAllMocks()
})

describe("POST /api/auth/email-change/cancel", () => {
  it("cancels a pending change so its link dies", async () => {
    requestEmailChange(identity, "new@lab.edu")
    expect(getPendingEmailChange("user:u1")).not.toBeNull()

    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, cancelled: true })
    expect(getPendingEmailChange("user:u1")).toBeNull()
  })

  it("is idempotent when nothing is pending", async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, cancelled: false })
  })

  it("rejects cross-origin requests and missing sessions", async () => {
    const crossOrigin = await post({ origin: "https://evil.example" })
    expect(crossOrigin.status).toBe(403)

    const { resolveEmailChangeIdentity } = await import("@/lib/email-change")
    vi.mocked(resolveEmailChangeIdentity).mockResolvedValueOnce(null)
    expect((await post()).status).toBe(401)
  })
})
