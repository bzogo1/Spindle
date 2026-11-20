import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  cancelEmailChange,
  confirmEmailChange,
  EMAIL_CHANGE_TTL_MS,
  emailChangeResendCooldown,
  getEffectiveEmail,
  getEmailChangeStatus,
  getPendingEmailChange,
  requestEmailChange,
  resetEmailChangeStoreForTests,
  resolveEmailChangeIdentity,
  type EmailChangeIdentity,
} from "./email-change"
import { setAuthBackendForTests, MemoryAuthBackend } from "@/lib/auth/backend"

const identity: EmailChangeIdentity = {
  principal: "user:u1",
  userId: "u1",
  email: "ada@lab.edu",
}

const mockIdentity: EmailChangeIdentity = {
  principal: "mock:ada@lab.edu",
  userId: null,
  email: "ada@lab.edu",
}

beforeEach(() => {
  resetEmailChangeStoreForTests()
  setAuthBackendForTests(undefined)
})

afterEach(() => {
  setAuthBackendForTests(undefined)
  vi.useRealTimers()
})

describe("requestEmailChange", () => {
  it("creates a pending change with a 24h expiry and a signed token", () => {
    const result = requestEmailChange(identity, "ADA@new.lab.edu")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pending.newEmail).toBe("ada@new.lab.edu")
    expect(result.pending.currentEmail).toBe("ada@lab.edu")
    expect(result.pending.principal).toBe("user:u1")
    expect(Date.parse(result.pending.expiresAt) - Date.parse(result.pending.requestedAt)).toBe(
      EMAIL_CHANGE_TTL_MS,
    )
    expect(result.token.split(".")).toHaveLength(3)
  })

  it("rejects invalid and unchanged addresses", () => {
    expect(requestEmailChange(identity, "not-an-email").ok).toBe(false)
    const same = requestEmailChange(identity, "Ada@lab.edu")
    expect(same).toEqual({ ok: false, error: "That is already your email address." })
    expect(getPendingEmailChange("user:u1")).toBeNull()
  })

  it("keeps one pending change per principal — a new request supersedes the old", () => {
    const first = requestEmailChange(identity, "one@lab.edu")
    const second = requestEmailChange(identity, "two@lab.edu")
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.pending.id).not.toBe(second.pending.id)
    const pending = getPendingEmailChange("user:u1")
    expect(pending?.newEmail).toBe("two@lab.edu")
  })

  it("expires pending records after the TTL", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    requestEmailChange(identity, "later@lab.edu")
    expect(getPendingEmailChange("user:u1")).not.toBeNull()
    vi.setSystemTime(1_000_000 + EMAIL_CHANGE_TTL_MS + 1)
    expect(getPendingEmailChange("user:u1")).toBeNull()
  })
})

describe("confirmEmailChange", () => {
  it("applies the change once and updates the effective email", async () => {
    const { token } = requestEmailChange(identity, "new@lab.edu") as { token: string }
    const result = await confirmEmailChange(token)
    expect(result).toMatchObject({
      ok: true,
      principal: "user:u1",
      userId: "u1",
      previousEmail: "ada@lab.edu",
      newEmail: "new@lab.edu",
    })
    expect(getEffectiveEmail("user:u1", "ada@lab.edu")).toBe("new@lab.edu")
    expect(getPendingEmailChange("user:u1")).toBeNull()
  })

  it("is single-use: a second confirm of the same token fails", async () => {
    const { token } = requestEmailChange(identity, "new@lab.edu") as { token: string }
    expect((await confirmEmailChange(token)).ok).toBe(true)
    const replay = await confirmEmailChange(token)
    expect(replay).toEqual({ ok: false, reason: "expired" })
  })

  it("rejects forged, malformed, and superseded tokens", async () => {
    const first = requestEmailChange(identity, "one@lab.edu") as { token: string }
    requestEmailChange(identity, "two@lab.edu") // rotates the pending id
    expect(await confirmEmailChange(first.token)).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(await confirmEmailChange("garbage")).toEqual({ ok: false, reason: "invalid" })
    expect(await confirmEmailChange("v1.e30.forged")).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("fails when the pending change was cancelled", async () => {
    const { token } = requestEmailChange(identity, "new@lab.edu") as { token: string }
    cancelEmailChange("user:u1")
    expect(await confirmEmailChange(token)).toEqual({ ok: false, reason: "expired" })
  })

  it("fails with email_unavailable when another backend user owns the address", async () => {
    const backend = new MemoryAuthBackend()
    await backend.upsertOAuthUser({ email: "taken@lab.edu", provider: "google" })
    setAuthBackendForTests(backend)

    requestEmailChange(identity, "taken@lab.edu")
    const pending = getPendingEmailChange("user:u1")
    expect(pending).not.toBeNull()
    // Grab the token through a fresh request result instead.
    const again = requestEmailChange(identity, "taken@lab.edu") as { token: string }
    const result = await confirmEmailChange(again.token)
    expect(result).toEqual({ ok: false, reason: "email_unavailable" })
    expect(getEffectiveEmail("user:u1", "ada@lab.edu")).toBe("ada@lab.edu")
  })

  it("allows mock principals (userId null) when the address is unclaimed", async () => {
    const { token } = requestEmailChange(mockIdentity, "new@lab.edu") as { token: string }
    const result = await confirmEmailChange(token)
    expect(result).toMatchObject({ ok: true, userId: null, newEmail: "new@lab.edu" })
    expect(getEffectiveEmail("mock:ada@lab.edu", "ada@lab.edu")).toBe("new@lab.edu")
  })
})

describe("cancelEmailChange / status / cooldown", () => {
  it("cancel removes the pending change and reports whether one existed", () => {
    expect(cancelEmailChange("user:u1")).toBe(false)
    requestEmailChange(identity, "new@lab.edu")
    expect(cancelEmailChange("user:u1")).toBe(true)
    expect(getPendingEmailChange("user:u1")).toBeNull()
  })

  it("status reports effective email, pending view, and cooldown", () => {
    const status = getEmailChangeStatus(identity)
    expect(status).toEqual({
      email: "ada@lab.edu",
      pending: null,
      resendCooldownSeconds: 0,
    })

    requestEmailChange(identity, "new@lab.edu")
    emailChangeResendCooldown.markSent("user:u1")
    const withPending = getEmailChangeStatus(identity)
    expect(withPending.email).toBe("ada@lab.edu")
    expect(withPending.pending?.newEmail).toBe("new@lab.edu")
    expect(withPending.resendCooldownSeconds).toBeGreaterThan(0)
  })
})

describe("resolveEmailChangeIdentity", () => {
  it("returns null without a session", async () => {
    const request = new Request("http://localhost/api/auth/email-change")
    expect(await resolveEmailChangeIdentity(request)).toBeNull()
  })
})
