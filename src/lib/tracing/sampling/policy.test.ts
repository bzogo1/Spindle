import { describe, expect, it } from "vitest"

import {
  decideTraceSample,
  durationKeepRule,
  hashToUnit,
  recommendedPolicy,
  resolveRate,
  routePattern,
  routeRule,
  tagKeepRule,
  type SamplingPolicy,
  type TraceSampleContext,
} from "./policy"

const ctx = (overrides: Partial<TraceSampleContext> = {}): TraceSampleContext => ({
  transactionName: "/pricing",
  traceId: "trace-1",
  ...overrides,
})

const policy = (overrides: Partial<SamplingPolicy> = {}): SamplingPolicy => ({
  defaultRate: 0.5,
  errorRate: 1,
  rules: [],
  forcedKeeps: [],
  ...overrides,
})

describe("hashToUnit", () => {
  it("is deterministic and within [0, 1)", () => {
    const a = hashToUnit("trace-abc")
    expect(hashToUnit("trace-abc")).toBe(a)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
  })

  it("distributes inputs across the unit interval", () => {
    const values = Array.from({ length: 200 }, (_, i) => hashToUnit(`t-${i}`))
    const low = values.filter((v) => v < 0.1).length
    // ~20 expected; assert a sane spread rather than exact equality.
    expect(low).toBeGreaterThan(5)
    expect(low).toBeLessThan(40)
  })
})

describe("resolveRate", () => {
  it("falls back to defaultRate when nothing matches", () => {
    expect(resolveRate(ctx(), policy({ defaultRate: 0.25 })).rate).toBe(0.25)
    expect(resolveRate(ctx(), policy({ defaultRate: 0.25 })).source).toBe("default")
  })

  it("clamps out-of-range rates", () => {
    expect(resolveRate(ctx(), policy({ defaultRate: 1.5 })).rate).toBe(1)
    expect(resolveRate(ctx(), policy({ defaultRate: -1 })).rate).toBe(0)
  })

  it("error signal wins over rules and default", () => {
    const p = policy({
      defaultRate: 0.01,
      rules: [routeRule(["/pricing"], 0.9, "marketing")],
    })
    expect(resolveRate(ctx({ hasError: true }), p).source).toBe("error")
    expect(resolveRate(ctx({ hasError: true }), p).rate).toBe(1)
    expect(resolveRate(ctx({ tags: { error: "true" } }), p).source).toBe("error")
    expect(resolveRate(ctx({ tags: { "http.status_code": "503" } }), p).source).toBe("error")
  })

  it("does not treat 4xx as an error signal", () => {
    const p = policy({ defaultRate: 0.3 })
    expect(resolveRate(ctx({ tags: { "http.status_code": "404" } }), p).source).toBe("default")
  })

  it("first matching rule wins", () => {
    const p = policy({
      rules: [routeRule(["GET /api/**"], 0.01, "api"), routeRule(["/**"], 0.5, "catch-all")],
    })
    expect(resolveRate(ctx({ transactionName: "GET /api/users" }), p)).toEqual({
      rate: 0.01,
      source: "api",
    })
    expect(resolveRate(ctx({ transactionName: "/pricing" }), p)).toEqual({
      rate: 0.5,
      source: "catch-all",
    })
  })
})

describe("routePattern", () => {
  const match = (pattern: string, name: string) =>
    routePattern(pattern)(ctx({ transactionName: name }))

  it("matches exact names", () => {
    expect(match("/pricing", "/pricing")).toBe(true)
    expect(match("/pricing", "/pricing/extra")).toBe(false)
  })

  it("supports * within a segment and ** across segments", () => {
    expect(match("/docs/**", "/docs/getting-started")).toBe(true)
    expect(match("/docs/**", "/docs/a/b/c")).toBe(true)
    expect(match("/docs/**", "/docsx/a")).toBe(false)
    expect(match("GET /api/*/items", "GET /api/v1/items")).toBe(true)
    expect(match("GET /api/*/items", "GET /api/v1/x/items")).toBe(false)
  })

  it("escapes regex metacharacters in the pattern", () => {
    expect(match("/a.b", "/a.b")).toBe(true)
    expect(match("/a.b", "/axb")).toBe(false)
  })
})

describe("decideTraceSample", () => {
  it("is deterministic for the same traceId", () => {
    const p = policy({ defaultRate: 0.5 })
    const a = decideTraceSample(ctx({ traceId: "stable-1" }), p)
    const b = decideTraceSample(ctx({ traceId: "stable-1" }), p)
    expect(a.sample).toBe(b.sample)
    expect(a.rate).toBe(b.rate)
  })

  it("falls back to transactionName when traceId is absent", () => {
    const p = policy({ defaultRate: 1 })
    expect(decideTraceSample(ctx({ traceId: undefined }), p).sample).toBe(true)
    const zero = policy({ defaultRate: 0 })
    expect(decideTraceSample(ctx({ traceId: undefined }), zero).sample).toBe(false)
  })

  it("rate 1 always samples, rate 0 never does", () => {
    expect(decideTraceSample(ctx(), policy({ defaultRate: 1 })).sample).toBe(true)
    expect(decideTraceSample(ctx(), policy({ defaultRate: 0 })).sample).toBe(false)
  })

  it("produces a mix at intermediate rates", () => {
    const p = policy({ defaultRate: 0.5 })
    const samples = Array.from(
      { length: 100 },
      (_, i) => decideTraceSample(ctx({ traceId: `mix-${i}` }), p).sample,
    )
    const kept = samples.filter(Boolean).length
    expect(kept).toBeGreaterThan(20)
    expect(kept).toBeLessThan(80)
  })

  it("forced keeps override a zero rate and report their reason", () => {
    const p = policy({
      defaultRate: 0,
      forcedKeeps: [durationKeepRule("slow", 1000, "over 1s")],
    })
    const d = decideTraceSample(ctx({ durationMs: 2500 }), p)
    expect(d.sample).toBe(true)
    expect(d.forcedBy).toBe("slow")
    expect(d.reason).toContain("forced keep")
    // Below the threshold the zero rate still drops.
    expect(decideTraceSample(ctx({ durationMs: 10 }), p).sample).toBe(false)
  })

  it("tag-based forced keeps fire on matching tags", () => {
    const p = policy({
      defaultRate: 0,
      forcedKeeps: [tagKeepRule("checkout", "flow", "checkout", "funnel")],
    })
    expect(decideTraceSample(ctx({ tags: { flow: "checkout" } }), p).sample).toBe(true)
    expect(decideTraceSample(ctx({ tags: { flow: "browse" } }), p).sample).toBe(false)
  })
})

describe("recommendedPolicy", () => {
  it("rates API routes lower than app routes", () => {
    const p = recommendedPolicy()
    const api = resolveRate(ctx({ transactionName: "GET /api/projects" }), p)
    const app = resolveRate(ctx({ transactionName: "/projects" }), p)
    expect(api.rate).toBeLessThan(app.rate)
    expect(api.source).toBe("api-low-volume")
  })

  it("drops static asset transactions entirely", () => {
    const p = recommendedPolicy()
    const d = decideTraceSample(ctx({ transactionName: "/_next/static/chunk.js" }), p)
    expect(d.rate).toBe(0)
    expect(d.sample).toBe(false)
  })

  it("keeps errors at rate 1 regardless of route", () => {
    const p = recommendedPolicy()
    const d = decideTraceSample(ctx({ transactionName: "GET /api/x", hasError: true }), p)
    expect(d.rate).toBe(1)
    expect(d.sample).toBe(true)
  })

  it("applies forced keeps for slow traces", () => {
    const p = recommendedPolicy()
    const d = decideTraceSample(ctx({ transactionName: "GET /api/slow", durationMs: 9000 }), p)
    expect(d.sample).toBe(true)
    expect(d.forcedBy).toBe("slow-trace")
  })
})
