import { describe, expect, it } from "vitest"

import {
  ENDPOINT_LIMIT_OVERRIDES,
  RATE_LIMIT_MATRIX,
  rateLimitBucketKey,
  rateLimitHeaders,
  resolveLimit,
  resolveTier,
} from "./tiers"

describe("resolveTier", () => {
  it("returns anonymous with no credentials", () => {
    expect(resolveTier({})).toBe("anonymous")
    expect(resolveTier({ userId: null, apiKeyId: null })).toBe("anonymous")
  })

  it("returns authenticated for a session user", () => {
    expect(resolveTier({ userId: "u_123" })).toBe("authenticated")
  })

  it("returns apiKey when an API key is present", () => {
    expect(resolveTier({ apiKeyId: "k_abc" })).toBe("apiKey")
  })

  it("prefers apiKey over a session when both are present", () => {
    expect(resolveTier({ userId: "u_123", apiKeyId: "k_abc" })).toBe("apiKey")
  })
})

describe("resolveLimit", () => {
  it("returns the tier × class default when no route override exists", () => {
    expect(resolveLimit("anonymous", "auth")).toEqual({ limit: 10, windowMs: 60_000 })
    expect(resolveLimit("authenticated", "read")).toEqual({ limit: 240, windowMs: 60_000 })
    expect(resolveLimit("apiKey", "write")).toEqual({ limit: 300, windowMs: 60_000 })
  })

  it("applies per-route overrides regardless of tier", () => {
    // /api/auth/signin is 10/min in code — same as the anonymous default.
    expect(resolveLimit("anonymous", "auth", "/api/auth/signin")).toEqual({
      limit: 10,
      windowMs: 60_000,
    })
    // /api/auth/signup is stricter: 5/hour.
    expect(resolveLimit("anonymous", "auth", "/api/auth/signup")).toEqual({
      limit: 5,
      windowMs: 3_600_000,
    })
    // Public form writes are hourly, far below the anonymous write default
    // would suggest if it were per-minute — overrides carry the real value.
    expect(resolveLimit("anonymous", "write", "/api/contact")).toEqual({
      limit: 5,
      windowMs: 3_600_000,
    })
  })

  it("override wins even for authenticated callers", () => {
    // /api/analytics/summary is 60/min keyed by principal in the route.
    expect(resolveLimit("authenticated", "expensive", "/api/analytics/summary")).toEqual({
      limit: 60,
      windowMs: 60_000,
    })
  })

  it("falls back to class default for unknown route paths", () => {
    expect(resolveLimit("authenticated", "read", "/api/does-not-exist")).toEqual(
      RATE_LIMIT_MATRIX.authenticated.read,
    )
  })

  it("every override has a sane positive limit and window", () => {
    for (const [route, window] of Object.entries(ENDPOINT_LIMIT_OVERRIDES)) {
      expect(window.limit, route).toBeGreaterThan(0)
      expect(window.windowMs, route).toBeGreaterThan(0)
    }
  })
})

describe("rateLimitBucketKey", () => {
  it("keys authenticated callers by user id", () => {
    expect(rateLimitBucketKey("authenticated", { userId: "u_1", ip: "1.2.3.4" })).toBe("user:u_1")
  })

  it("keys api-key callers by key id", () => {
    expect(rateLimitBucketKey("apiKey", { apiKeyId: "k_1", userId: "u_1" })).toBe("key:k_1")
  })

  it("keys anonymous callers by IP", () => {
    expect(rateLimitBucketKey("anonymous", { ip: " 9.9.9.9 " })).toBe("ip:9.9.9.9")
  })

  it("falls back to a shared unknown bucket", () => {
    expect(rateLimitBucketKey("anonymous", {})).toBe("ip:unknown")
    expect(rateLimitBucketKey("anonymous", { ip: "  " })).toBe("ip:unknown")
  })
})

describe("rateLimitHeaders", () => {
  const now = 1_700_000_000_000

  it("emits RateLimit-* headers with seconds-until-reset", () => {
    const headers = rateLimitHeaders({ limit: 10, remaining: 4, resetAt: now + 30_000 }, now)
    expect(headers).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "4",
      "RateLimit-Reset": "30",
    })
  })

  it("rounds partial seconds up and clamps negatives", () => {
    expect(
      rateLimitHeaders({ limit: 5, remaining: 0, resetAt: now + 1 }, now)["RateLimit-Reset"],
    ).toBe("1")
    expect(
      rateLimitHeaders({ limit: 5, remaining: 0, resetAt: now - 5_000 }, now)["RateLimit-Reset"],
    ).toBe("0")
  })

  it("never reports negative remaining", () => {
    expect(
      rateLimitHeaders({ limit: 5, remaining: -2, resetAt: now + 10_000 }, now)[
        "RateLimit-Remaining"
      ],
    ).toBe("0")
  })

  it("adds Retry-After only when retryAfterMs is positive", () => {
    const denied = rateLimitHeaders(
      { limit: 10, remaining: 0, resetAt: now + 4_200, retryAfterMs: 4_200 },
      now,
    )
    expect(denied["Retry-After"]).toBe("5")

    const allowed = rateLimitHeaders(
      { limit: 10, remaining: 9, resetAt: now + 4_200, retryAfterMs: 0 },
      now,
    )
    expect(allowed["Retry-After"]).toBeUndefined()
  })
})
