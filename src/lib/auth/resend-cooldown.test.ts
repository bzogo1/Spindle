import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createResendCooldown,
  VERIFY_EMAIL_RESEND_COOLDOWN_MS,
  VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS,
  verifyEmailResendCooldown,
} from "./resend-cooldown"

afterEach(() => {
  verifyEmailResendCooldown.reset()
  vi.useRealTimers()
})

describe("createResendCooldown", () => {
  it("allows a send when nothing was sent before", () => {
    const cooldown = createResendCooldown()

    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(0)
  })

  it("reports the full cooldown right after markSent and counts down", () => {
    let at = 1_000_000
    const cooldown = createResendCooldown({ now: () => at })

    cooldown.markSent("ada@lab.edu")
    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS)

    at += 30_000
    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(30)

    at += VERIFY_EMAIL_RESEND_COOLDOWN_MS
    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(0)
  })

  it("rounds partial seconds up so retryAfter is never optimistic", () => {
    let at = 0
    const cooldown = createResendCooldown({ cooldownMs: 10_000, now: () => at })

    cooldown.markSent("ada@lab.edu")
    at = 9_500
    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(1)

    at = 10_000
    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(0)
  })

  it("tracks addresses independently and normalizes case/whitespace", () => {
    let at = 0
    const cooldown = createResendCooldown({ cooldownMs: 60_000, now: () => at })

    cooldown.markSent("  Ada@Lab.EDU ")

    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(60)
    expect(cooldown.remainingSeconds("grace@lab.edu")).toBe(0)
  })

  it("reset() clears every tracked address", () => {
    const cooldown = createResendCooldown()

    cooldown.markSent("ada@lab.edu")
    cooldown.markSent("grace@lab.edu")
    cooldown.reset()

    expect(cooldown.remainingSeconds("ada@lab.edu")).toBe(0)
    expect(cooldown.remainingSeconds("grace@lab.edu")).toBe(0)
  })
})

describe("verifyEmailResendCooldown singleton", () => {
  it("uses Date.now so fake timers can advance the window", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    verifyEmailResendCooldown.markSent("ada@lab.edu")
    expect(verifyEmailResendCooldown.remainingSeconds("ada@lab.edu")).toBe(
      VERIFY_EMAIL_RESEND_COOLDOWN_SECONDS,
    )

    vi.setSystemTime(1_000_000 + VERIFY_EMAIL_RESEND_COOLDOWN_MS + 1)
    expect(verifyEmailResendCooldown.remainingSeconds("ada@lab.edu")).toBe(0)
  })
})
