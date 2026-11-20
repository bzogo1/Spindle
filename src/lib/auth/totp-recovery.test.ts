// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  hashRecoveryToken,
  isRecoveryDue,
  MemoryTotpRecoveryStore,
  recoverySecondsRemaining,
  RECOVERY_COOLDOWN_MS,
} from "./totp-recovery"

const USER = { userId: "u1", email: "Ada@Lab.Edu" }

function storeWithClock(start = 1_000_000) {
  let now = start
  const store = new MemoryTotpRecoveryStore(RECOVERY_COOLDOWN_MS, () => now)
  return {
    store,
    advance: (ms: number) => (now += ms),
    set: (t: number) => (now = t),
    get: () => now,
  }
}

describe("MemoryTotpRecoveryStore", () => {
  it("creates an awaiting_token recovery and normalizes the email", () => {
    const { store } = storeWithClock()
    const result = store.create(USER)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resent).toBe(false)
    expect(result.record.phase).toBe("awaiting_token")
    expect(result.record.email).toBe("ada@lab.edu")
    expect(result.record.executeAt).toBeNull()
    expect(store.getActive(USER.userId)?.id).toBe(result.record.id)
  })

  it("returns the pending record on a second create (resent) without duplicating", () => {
    const { store } = storeWithClock()
    const first = store.create(USER)
    const second = store.create(USER)
    expect(second.ok).toBe(true)
    if (!second.ok || !first.ok) return
    expect(second.resent).toBe(true)
    expect(second.record.id).toBe(first.record.id)
  })

  it("refuses a new request while a cooldown is active", () => {
    const { store } = storeWithClock()
    store.create(USER)
    store.consumeToken(USER.userId)
    const again = store.create(USER)
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.reason).toBe("cooldown_active")
    expect(again.record.phase).toBe("cooldown")
    expect(again.record.executeAt).not.toBeNull()
  })

  it("consumeToken moves awaiting_token → cooldown with executeAt = now + cooldown", () => {
    const { store } = storeWithClock(5_000)
    store.create(USER)
    const record = store.consumeToken(USER.userId)
    expect(record?.phase).toBe("cooldown")
    expect(record?.tokenConsumedAt).not.toBeNull()
    expect(Date.parse(record!.executeAt!)).toBe(5_000 + RECOVERY_COOLDOWN_MS)
    // Second consume is a no-op.
    expect(store.consumeToken(USER.userId)).toBeNull()
  })

  it("consumeToken returns null when nothing is awaiting a token", () => {
    const { store } = storeWithClock()
    expect(store.consumeToken("nobody")).toBeNull()
    store.create(USER)
    store.consumeToken(USER.userId)
    // Already in cooldown — cannot consume again.
    expect(store.consumeToken(USER.userId)).toBeNull()
  })

  it("finalize completes a due cooldown and frees the slot for a new recovery", () => {
    const { store, advance } = storeWithClock()
    expect(store.finalize(USER.userId)).toBeNull()
    store.create(USER)
    expect(store.finalize(USER.userId)).toBeNull() // still awaiting_token
    store.consumeToken(USER.userId)
    expect(store.finalize(USER.userId)).toBeNull() // cooldown not due yet
    advance(RECOVERY_COOLDOWN_MS)
    const done = store.finalize(USER.userId)
    expect(done?.phase).toBe("completed")
    expect(done?.resolvedAt).not.toBeNull()
    expect(store.getActive(USER.userId)).toBeNull()
    // Terminal: a fresh recovery may now be created.
    expect(store.create(USER).ok).toBe(true)
  })

  it("cancel aborts awaiting_token and cooldown recoveries", () => {
    const { store } = storeWithClock()
    expect(store.cancel(USER.userId)).toBeNull()
    store.create(USER)
    expect(store.cancel(USER.userId)?.phase).toBe("cancelled")
    expect(store.getActive(USER.userId)).toBeNull()

    store.create(USER)
    store.consumeToken(USER.userId)
    expect(store.cancel(USER.userId)?.phase).toBe("cancelled")
    expect(store.getActive(USER.userId)).toBeNull()
  })

  it("cancelled/completed records do not block a new recovery", () => {
    const { store } = storeWithClock()
    store.create(USER)
    store.cancel(USER.userId)
    const second = store.create(USER)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.record.phase).toBe("awaiting_token")
  })

  it("markEmailSent stamps lastEmailSentAt on the active record", () => {
    const { store, advance } = storeWithClock(1_000)
    store.create(USER)
    // No email has been sent yet — the throttle must not be armed.
    expect(store.getActive(USER.userId)!.lastEmailSentAt).toBeNull()
    advance(60_000)
    store.markEmailSent(USER.userId)
    const active = store.getActive(USER.userId)
    expect(Date.parse(active!.lastEmailSentAt!)).toBe(61_000)
    // Terminal records are untouched.
    store.cancel(USER.userId)
    store.markEmailSent(USER.userId)
  })

  it("bindToken records the token hash only while awaiting_token", () => {
    const { store } = storeWithClock()
    store.create(USER)
    store.bindToken(USER.userId, hashRecoveryToken("tok-1"))
    expect(store.getActive(USER.userId)!.tokenHash).toBe(hashRecoveryToken("tok-1"))

    store.consumeToken(USER.userId)
    store.bindToken(USER.userId, hashRecoveryToken("tok-2"))
    expect(store.getActive(USER.userId)!.tokenHash).toBe(hashRecoveryToken("tok-1"))
  })

  it("finalize completes only when due, atomically", () => {
    const { store, advance } = storeWithClock(0)
    store.create(USER)
    expect(store.finalize(USER.userId)).toBeNull() // awaiting_token
    store.consumeToken(USER.userId)
    expect(store.finalize(USER.userId)).toBeNull() // not due yet

    advance(RECOVERY_COOLDOWN_MS)
    const done = store.finalize(USER.userId)
    expect(done?.phase).toBe("completed")
    // Second finalize loses the race / finds terminal state.
    expect(store.finalize(USER.userId)).toBeNull()
    expect(store.getActive(USER.userId)).toBeNull()
  })
})

describe("isRecoveryDue / recoverySecondsRemaining", () => {
  it("is due only in cooldown at/after executeAt", () => {
    const { store, advance, get } = storeWithClock(0)
    store.create(USER)
    const awaiting = store.getActive(USER.userId)!
    expect(isRecoveryDue(awaiting)).toBe(false)

    store.consumeToken(USER.userId)
    const cooling = store.getActive(USER.userId)!
    expect(isRecoveryDue(cooling, RECOVERY_COOLDOWN_MS - 1)).toBe(false)
    expect(isRecoveryDue(cooling, RECOVERY_COOLDOWN_MS)).toBe(true)
    expect(recoverySecondsRemaining(cooling, 0)).toBe(Math.ceil(RECOVERY_COOLDOWN_MS / 1000))
    advance(RECOVERY_COOLDOWN_MS - 30_000)
    expect(recoverySecondsRemaining(store.getActive(USER.userId)!, get())).toBe(30)
  })
})
