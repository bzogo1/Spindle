// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  LOCKOUT_EMAIL_BASE_MS,
  LOCKOUT_EMAIL_THRESHOLD,
  LOCKOUT_FAILURE_WINDOW_MS,
  LOCKOUT_PAIR_BASE_MS,
  LOCKOUT_PAIR_MAX_MS,
  LOCKOUT_PAIR_THRESHOLD,
  MemorySignInLockout,
} from "./lockout"

const EMAIL = "ada@lab.edu"
const IP = "203.0.113.7"

function failUntilLocked(
  store: MemorySignInLockout,
  count: number,
  email = EMAIL,
  ip: string | null = IP,
  start = 1_000_000,
) {
  let status = store.check(email, ip, start)
  for (let i = 0; i < count; i += 1) {
    status = store.recordFailure(email, ip, start + i * 1000)
  }
  return status
}

describe("MemorySignInLockout", () => {
  it("reports unlocked for unknown keys and empty emails", () => {
    const store = new MemorySignInLockout()
    expect(store.check("nobody@nowhere.test", IP)).toEqual({
      locked: false,
      lockedUntil: null,
      retryAfterSeconds: 0,
    })
    expect(store.check("")).toEqual({ locked: false, lockedUntil: null, retryAfterSeconds: 0 })
    expect(store.recordFailure("")).toEqual({
      locked: false,
      lockedUntil: null,
      retryAfterSeconds: 0,
    })
  })

  it("normalizes email casing and whitespace", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    for (let i = 0; i < LOCKOUT_PAIR_THRESHOLD; i += 1) {
      store.recordFailure(`  ${EMAIL.toUpperCase()} `, IP, start + i * 1000)
    }
    expect(store.check(EMAIL, IP, start + 60_000).locked).toBe(true)
  })

  it("locks an ip+email pair after the pair threshold and reports retryAfter", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    for (let i = 0; i < LOCKOUT_PAIR_THRESHOLD - 1; i += 1) {
      const status = store.recordFailure(EMAIL, IP, start + i * 1000)
      expect(status.locked).toBe(false)
    }
    const status = store.recordFailure(EMAIL, IP, start + 10_000)
    expect(status.locked).toBe(true)
    expect(status.lockedUntil).toBe(start + 10_000 + LOCKOUT_PAIR_BASE_MS)
    expect(status.retryAfterSeconds).toBe(LOCKOUT_PAIR_BASE_MS / 1000)

    // check() sees the lock without recording anything.
    const seen = store.check(EMAIL, IP, start + 11_000)
    expect(seen.locked).toBe(true)
    expect(seen.retryAfterSeconds).toBe(Math.ceil((LOCKOUT_PAIR_BASE_MS - 1000) / 1000))
  })

  it("does not lock the pair for a different ip or a different email", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    for (let i = 0; i < LOCKOUT_PAIR_THRESHOLD; i += 1) {
      store.recordFailure(EMAIL, IP, start + i * 1000)
    }
    expect(store.check(EMAIL, "198.51.100.9", start + 20_000).locked).toBe(false)
    expect(store.check("other@lab.edu", IP, start + 20_000).locked).toBe(false)
  })

  it("locks the email across IPs only at the higher email threshold", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    // Rotate IPs so no single pair reaches its threshold (5 per pair needed).
    // 7 failures across 7 IPs: below email threshold (8), no locks at all.
    for (let i = 0; i < LOCKOUT_EMAIL_THRESHOLD - 1; i += 1) {
      const status = store.recordFailure(EMAIL, `198.51.100.${i}`, start + i * 1000)
      expect(status.locked).toBe(false)
    }
    const status = store.recordFailure(EMAIL, "192.0.2.55", start + 60_000)
    expect(status.locked).toBe(true)
    expect(status.lockedUntil).toBe(start + 60_000 + LOCKOUT_EMAIL_BASE_MS)
    // The email lock applies to every IP, including fresh ones.
    expect(store.check(EMAIL, "203.0.113.99", start + 61_000).locked).toBe(true)
  })

  it("escalates lock duration on repeat lockouts and caps at the maximum", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    let at = start
    const durations: number[] = []
    for (let cycle = 0; cycle < 3; cycle += 1) {
      // Burn through the threshold, record the lock duration, then fast-
      // forward past the lock AND the failure window.
      let status = store.check(EMAIL, IP, at)
      for (let i = 0; i < LOCKOUT_PAIR_THRESHOLD && !status.locked; i += 1) {
        at += 1000
        status = store.recordFailure(EMAIL, IP, at)
      }
      expect(status.locked).toBe(true)
      durations.push((status.lockedUntil ?? 0) - at)
      at = (status.lockedUntil ?? 0) + LOCKOUT_FAILURE_WINDOW_MS + 1000
    }
    expect(durations[0]).toBe(LOCKOUT_PAIR_BASE_MS)
    expect(durations[1]).toBe(LOCKOUT_PAIR_BASE_MS * 2)
    expect(durations[2]).toBe(LOCKOUT_PAIR_BASE_MS * 4)

    // Keep cycling until the cap is reached.
    let last = durations[durations.length - 1]
    for (let cycle = 0; cycle < 10 && last < LOCKOUT_PAIR_MAX_MS; cycle += 1) {
      let status = store.check(EMAIL, IP, at)
      for (let i = 0; i < LOCKOUT_PAIR_THRESHOLD && !status.locked; i += 1) {
        at += 1000
        status = store.recordFailure(EMAIL, IP, at)
      }
      last = (status.lockedUntil ?? 0) - at
      expect(last).toBeLessThanOrEqual(LOCKOUT_PAIR_MAX_MS)
      at = (status.lockedUntil ?? 0) + LOCKOUT_FAILURE_WINDOW_MS + 1000
    }
    expect(last).toBe(LOCKOUT_PAIR_MAX_MS)
    expect(LOCKOUT_PAIR_MAX_MS).toBeGreaterThan(LOCKOUT_EMAIL_BASE_MS / 2)
  })

  it("decays escalation after the decay window", () => {
    const store = new MemorySignInLockout()
    let at = 1_000_000
    // Lock once.
    let status = failUntilLocked(store, LOCKOUT_PAIR_THRESHOLD, EMAIL, IP, at)
    expect(status.locked).toBe(true)
    // Wait past lock + window + escalation decay, then attack again.
    at = (status.lockedUntil ?? 0) + LOCKOUT_FAILURE_WINDOW_MS + 25 * 60 * 60 * 1000
    status = failUntilLocked(store, LOCKOUT_PAIR_THRESHOLD, EMAIL, IP, at)
    expect(status.locked).toBe(true)
    // Escalation decayed: back to base duration, not doubled. The lock
    // triggers on the last failure, 4s after `at` (1s spacing).
    const triggerOffset = (LOCKOUT_PAIR_THRESHOLD - 1) * 1000
    expect((status.lockedUntil ?? 0) - at).toBe(LOCKOUT_PAIR_BASE_MS + triggerOffset)
  })

  it("does not extend the lock when failures continue during it", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    const locked = failUntilLocked(store, LOCKOUT_PAIR_THRESHOLD, EMAIL, IP, start)
    const lockedUntil = locked.lockedUntil ?? 0
    // Hammer during the lock: status stays locked, deadline unchanged.
    for (let i = 1; i <= 20; i += 1) {
      const status = store.recordFailure(EMAIL, IP, start + i * 1000)
      expect(status.locked).toBe(true)
      expect(status.lockedUntil).toBe(lockedUntil)
    }
    // After expiry the account is unlocked until fresh failures accumulate.
    const after = store.check(EMAIL, IP, lockedUntil + 1)
    expect(after.locked).toBe(false)
  })

  it("resets all state on recordSuccess", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    // 3 failures from each of two IPs: below both thresholds, state accumulates.
    for (let i = 0; i < 3; i += 1) {
      store.recordFailure(EMAIL, IP, start + i * 1000)
      store.recordFailure(EMAIL, "198.51.100.1", start + i * 1000)
    }
    expect(store.check(EMAIL, IP, start + 60_000).locked).toBe(false)
    expect(store.size().emails).toBe(1)
    expect(store.size().pairs).toBe(2)
    store.recordSuccess(EMAIL, start + 61_000)
    expect(store.size()).toEqual({ emails: 0, pairs: 0 })
    // Fresh failures start from zero again — 4 is still below the pair
    // threshold, so nothing locks.
    const status = failUntilLocked(store, LOCKOUT_PAIR_THRESHOLD - 1, EMAIL, IP, start + 120_000)
    expect(status.locked).toBe(false)
  })

  it("treats unknown emails identically to known ones", () => {
    const store = new MemorySignInLockout()
    const start = 1_000_000
    const known = failUntilLocked(store, LOCKOUT_PAIR_THRESHOLD, EMAIL, IP, start)
    const unknown = failUntilLocked(store, LOCKOUT_PAIR_THRESHOLD, "ghost@nowhere.test", IP, start)
    expect(known.locked).toBe(true)
    expect(unknown.locked).toBe(true)
    expect(unknown.lockedUntil).toBe(known.lockedUntil)
  })
})
