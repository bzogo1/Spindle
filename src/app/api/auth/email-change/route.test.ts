import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"
import {
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

function get(headers: Record<string, string> = {}) {
  return GET(new Request("http://localhost/api/auth/email-change", { headers }))
}

beforeEach(() => {
  resetEmailChangeStoreForTests()
  vi.clearAllMocks()
})

describe("GET /api/auth/email-change", () => {
  it("returns the effective email and no pending change", async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      emailChange: {
        email: "ada@lab.edu",
        pending: null,
        resendCooldownSeconds: 0,
      },
    })
  })

  it("includes the pending change once one is requested", async () => {
    requestEmailChange(identity, "new@lab.edu")
    const response = await get()
    const payload = await response.json()
    expect(payload.emailChange.pending.newEmail).toBe("new@lab.edu")
    expect(payload.emailChange.pending.expiresAt).toBeTruthy()
  })
})
