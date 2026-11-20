import { describe, expect, it } from "vitest"

import { createSlidingWindowLimiter, rateLimitKey, RATE_LIMIT_TIERS } from "./sliding-window"

function clock(start = 1_000_000) {
  let at = start
  return {
    now: () => at,
    advance(ms: number) {
      at += ms
    },
  }
}

describe("createSlidingWindowLimiter", () => {
  it("allows up to `limit` requests then denies", () => {
    const { now } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 1000, now })

    expect(limiter.check("a").allowed).toBe(true)
    expect(limiter.check("a").allowed).toBe(true)
    expect(limiter.check("a").allowed).toBe(true)

    const denied = limiter.check("a")
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
    expect(denied.retryAfterMs).toBeGreaterThan(0)
    expect(denied.resetAt).toBe(1_000_000 + 1000)
  })

  it("slides: old hits expire individually instead of resetting the window", () => {
    const { now, advance } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 1000, now })

    limiter.check("a") // t=0
    advance(600)
    limiter.check("a") // t=600
    advance(500) // t=1100: first hit expired, second still counts
    expect(limiter.check("a").allowed).toBe(true)
    // Two live hits now (t=600, t=1100) → next denied until t=1600.
    expect(limiter.check("a").allowed).toBe(false)
    advance(500) // t=1600: t=600 hit expires
    expect(limiter.check("a").allowed).toBe(true)
  })

  it("does not allow the fixed-window boundary burst", () => {
    const { now, advance } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 1000, now })

    limiter.check("a") // t=0
    advance(600)
    limiter.check("a") // t=600
    // t=999: both hits live → denied. A fixed-window limiter aligned to t=0
    // would also deny here, but it would then allow a fresh `limit` burst at
    // t=1000 even though the t=600 hit is still inside its own window.
    advance(399)
    expect(limiter.check("a").allowed).toBe(false)
    advance(1) // t=1000: only the t=0 hit expires
    expect(limiter.check("a").allowed).toBe(true)
    // The t=600 hit plus the new t=1000 hit fill the window — no burst.
    expect(limiter.check("a").allowed).toBe(false)
  })

  it("tracks keys independently", () => {
    const { now } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 1000, now })

    expect(limiter.check("a").allowed).toBe(true)
    expect(limiter.check("a").allowed).toBe(false)
    expect(limiter.check("b").allowed).toBe(true)
    expect(limiter.size()).toBe(2)
  })

  it("reports remaining count down to zero", () => {
    const { now } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 1000, now })

    expect(limiter.check("a").remaining).toBe(2)
    expect(limiter.check("a").remaining).toBe(1)
    expect(limiter.check("a").remaining).toBe(0)
  })

  it("bounds memory by evicting when maxKeys is exceeded", () => {
    const { now } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 5, windowMs: 60_000, now, maxKeys: 3 })

    for (let i = 0; i < 10; i += 1) limiter.check(`key-${i}`)
    expect(limiter.size()).toBeLessThanOrEqual(3)
    // The most recent keys survive.
    expect(limiter.check("key-9").allowed).toBe(true)
  })

  it("sweeps expired buckets before evicting live ones", () => {
    const { now, advance } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 5, windowMs: 1000, now, maxKeys: 2 })

    limiter.check("old-1")
    limiter.check("old-2")
    advance(2000) // both expire
    limiter.check("new-1")
    limiter.check("new-2")
    limiter.check("new-3") // forces a sweep; expired buckets are gone first

    expect(limiter.size()).toBeLessThanOrEqual(2)
  })
})

describe("rateLimitKey", () => {
  it("prefers cf-connecting-ip over x-forwarded-for", () => {
    const request = new Request("https://app.example/", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1",
      },
    })
    expect(rateLimitKey(request)).toBe("ip:203.0.113.10")
  })

  it("uses the first x-forwarded-for hop", () => {
    const request = new Request("https://app.example/", {
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    })
    expect(rateLimitKey(request)).toBe("ip:198.51.100.1")
  })

  it("falls back to a shared unknown bucket", () => {
    const request = new Request("https://app.example/")
    expect(rateLimitKey(request)).toBe("ip:unknown")
  })
})

describe("RATE_LIMIT_TIERS", () => {
  it("keeps auth limits stricter than api limits", () => {
    expect(RATE_LIMIT_TIERS.auth.limit).toBeLessThanOrEqual(RATE_LIMIT_TIERS.api.limit)
    expect(RATE_LIMIT_TIERS.apiPublic.limit).toBeLessThanOrEqual(RATE_LIMIT_TIERS.api.limit)
    for (const tier of Object.values(RATE_LIMIT_TIERS)) {
      expect(tier.limit).toBeGreaterThan(0)
      expect(tier.windowMs).toBeGreaterThan(0)
    }
  })
})

describe("createSlidingWindowLimiter edge cases", () => {
  it("handles limit of 1", () => {
    const { now } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 500, now })
    expect(limiter.check("a").allowed).toBe(true)
    expect(limiter.check("a").allowed).toBe(false)
  })

  it("expires all hits after a full quiet window", () => {
    const { now, advance } = clock()
    const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 500, now })

    limiter.check("a")
    limiter.check("a") // denied
    advance(501)
    expect(limiter.check("a").allowed).toBe(true)
    expect(limiter.size()).toBe(1)
  })
})
