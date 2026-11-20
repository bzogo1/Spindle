// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
  passwordResetRequestCooldown,
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
} from "./auth-endpoint-rate-limit"

describe("AUTH_LIMITS", () => {
  it("exposes the four shared auth endpoint tiers", () => {
    expect(AUTH_LIMITS.emailSend).toEqual({ limit: 5, windowMs: 10 * 60 * 1000 })
    expect(AUTH_LIMITS.tokenConsume).toEqual({ limit: 10, windowMs: 10 * 60 * 1000 })
    expect(AUTH_LIMITS.tokenConsumeFast).toEqual({ limit: 10, windowMs: 60 * 1000 })
    expect(AUTH_LIMITS.publicRead).toEqual({ limit: 60, windowMs: 60 * 1000 })
  })
})

describe("createAuthRateLimiter", () => {
  it("allows up to the preset limit per key, then denies", () => {
    const limiter = createAuthRateLimiter("tokenConsumeFast")

    for (let i = 0; i < AUTH_LIMITS.tokenConsumeFast.limit; i += 1) {
      expect(limiter.check("ip:1.2.3.4")).toBe(true)
    }
    expect(limiter.check("ip:1.2.3.4")).toBe(false)
    // Other keys are unaffected.
    expect(limiter.check("ip:5.6.7.8")).toBe(true)
  })

  it("honours an injected clock", () => {
    let at = 0
    const limiter = createAuthRateLimiter("publicRead", () => at)

    expect(limiter.check("ip:9.9.9.9")).toBe(true)
    at += AUTH_LIMITS.publicRead.windowMs + 1
    // Window expired: the key is allowed again.
    expect(limiter.check("ip:9.9.9.9")).toBe(true)
  })
})

describe("clientIp", () => {
  it("returns the first x-forwarded-for hop", () => {
    const request = new Request("http://localhost/api/auth/x", {
      headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
    })
    expect(clientIp(request)).toBe("203.0.113.9")
  })

  it("falls back to 'unknown' without forwarding headers", () => {
    expect(clientIp(new Request("http://localhost/api/auth/x"))).toBe("unknown")
  })
})

describe("authRateLimited", () => {
  it("returns the shared 429 envelope", async () => {
    const response = authRateLimited()
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "rate_limited",
      message: "Too many attempts. Try again later.",
    })
  })
})

describe("passwordResetRequestCooldown", () => {
  it("tracks a per-email window that resets cleanly", () => {
    passwordResetRequestCooldown.reset()

    expect(passwordResetRequestCooldown.remainingSeconds("a@b.c")).toBe(0)
    passwordResetRequestCooldown.markSent("a@b.c")
    expect(passwordResetRequestCooldown.remainingSeconds("a@b.c")).toBeGreaterThan(0)
    expect(passwordResetRequestCooldown.remainingSeconds("a@b.c")).toBeLessThanOrEqual(
      PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS,
    )
    // Different addresses are independent.
    expect(passwordResetRequestCooldown.remainingSeconds("x@y.z")).toBe(0)

    passwordResetRequestCooldown.reset()
    expect(passwordResetRequestCooldown.remainingSeconds("a@b.c")).toBe(0)
  })
})
