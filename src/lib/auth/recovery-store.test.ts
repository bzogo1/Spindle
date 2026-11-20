import { describe, expect, it } from "vitest"

import {
  MemoryAccountRecoveryStore,
  RECOVERY_RESEND_MS,
  RECOVERY_SESSION_TTL_MS,
  RECOVERY_TOKEN_TTL_MS,
} from "./recovery-store"

function makeStore(now?: () => number) {
  return new MemoryAccountRecoveryStore(
    RECOVERY_TOKEN_TTL_MS,
    RECOVERY_SESSION_TTL_MS,
    RECOVERY_RESEND_MS,
    now,
  )
}

describe("MemoryAccountRecoveryStore", () => {
  it("issues a pending recovery and returns the raw token once", () => {
    const store = makeStore()
    const issued = store.issue({ userId: "u1", email: "Ada@Lab.Edu" })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    expect(issued.record.phase).toBe("pending")
    expect(issued.record.email).toBe("ada@lab.edu")
    expect(issued.record.tokenHash).not.toBe(issued.token)
    expect(store.getActive("u1")?.id).toBe(issued.record.id)
  })

  it("throttles resends within the resend window without disturbing state", () => {
    let at = 1_000_000
    const store = makeStore(() => at)
    const first = store.issue({ userId: "u1", email: "ada@lab.edu" })
    expect(first.ok).toBe(true)

    at += RECOVERY_RESEND_MS - 1
    const second = store.issue({ userId: "u1", email: "ada@lab.edu" })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe("resend_throttled")
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    // The original record (and its token) is untouched.
    expect(store.getActive("u1")?.id).toBe(first.ok ? first.record.id : "")

    at += 2
    const third = store.issue({ userId: "u1", email: "ada@lab.edu" })
    expect(third.ok).toBe(true)
    // Re-issue rotates the token: the old one no longer resolves.
    if (first.ok && third.ok) {
      expect(store.consumeToken(first.token).ok).toBe(false)
    }
  })

  it("does not throttle across different users", () => {
    const store = makeStore()
    store.issue({ userId: "u1", email: "a@lab.edu" })
    expect(store.issue({ userId: "u2", email: "b@lab.edu" }).ok).toBe(true)
  })

  it("consumes a token exactly once and returns a session token", () => {
    const store = makeStore()
    const issued = store.issue({ userId: "u1", email: "ada@lab.edu" })
    if (!issued.ok) throw new Error("issue failed")

    const consumed = store.consumeToken(issued.token)
    expect(consumed.ok).toBe(true)
    if (!consumed.ok) return
    expect(consumed.record.phase).toBe("verified")
    expect(consumed.sessionToken).not.toBe(issued.token)

    // The emailed token is dead: replay reports "used".
    expect(store.consumeToken(issued.token)).toEqual({ ok: false, reason: "used" })
    // The session token resolves the record.
    const viaSession = store.getBySessionToken(consumed.sessionToken)
    expect(viaSession?.userId).toBe("u1")
  })

  it("reports expired and invalid tokens distinctly", () => {
    let at = 1_000_000
    const store = makeStore(() => at)
    const issued = store.issue({ userId: "u1", email: "ada@lab.edu" })
    if (!issued.ok) throw new Error("issue failed")

    expect(store.consumeToken("nope")).toEqual({ ok: false, reason: "invalid" })

    at += RECOVERY_TOKEN_TTL_MS + 1
    expect(store.consumeToken(issued.token)).toEqual({ ok: false, reason: "expired" })
  })

  it("expires the recovery session token", () => {
    let at = 1_000_000
    const store = makeStore(() => at)
    const issued = store.issue({ userId: "u1", email: "ada@lab.edu" })
    if (!issued.ok) throw new Error("issue failed")
    const consumed = store.consumeToken(issued.token)
    if (!consumed.ok) throw new Error("consume failed")

    at += RECOVERY_SESSION_TTL_MS + 1
    expect(store.getBySessionToken(consumed.sessionToken)).toBeNull()
  })

  it("marks steps only while verified and completes terminally", () => {
    const store = makeStore()
    const issued = store.issue({ userId: "u1", email: "ada@lab.edu" })
    if (!issued.ok) throw new Error("issue failed")

    // Pending records ignore step stamps.
    store.markPasswordReset("u1")
    store.markEmailVerified("u1")
    expect(store.getActive("u1")?.actions).toEqual({
      passwordResetAt: null,
      emailVerifiedAt: null,
    })

    const consumed = store.consumeToken(issued.token)
    if (!consumed.ok) throw new Error("consume failed")
    store.markPasswordReset("u1")
    store.markEmailVerified("u1")
    expect(store.getActive("u1")?.actions.passwordResetAt).not.toBeNull()
    expect(store.getActive("u1")?.actions.emailVerifiedAt).not.toBeNull()

    const completed = store.complete("u1")
    expect(completed?.phase).toBe("completed")
    expect(completed?.tokenHash).toBeNull()
    expect(completed?.sessionTokenHash).toBeNull()
    expect(store.getActive("u1")).toBeNull()
    expect(store.complete("u1")).toBeNull()
  })
})
