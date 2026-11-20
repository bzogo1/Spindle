import { describe, expect, it } from "vitest"

import {
  FUNNELS,
  analyzeFunnel,
  analyzeFunnels,
  actorKeyFor,
  generateDemoFunnelEvents,
  getFunnel,
  matchesFunnelStep,
  matchesStep,
  type FunnelDefinition,
  type FunnelEvent,
} from "./index"

const T0 = 1_700_000_000_000
const MIN = 60_000

function ev(partial: Partial<FunnelEvent> & { name: string }): FunnelEvent {
  return { timestamp: T0, actorId: "user:u1", ...partial }
}

const twoStep: FunnelDefinition = {
  id: "test_funnel",
  name: "Test funnel",
  steps: [
    { id: "a", label: "A", anyOf: [{ names: ["step_a"] }] },
    { id: "b", label: "B", anyOf: [{ names: ["step_b"] }] },
  ],
}

describe("matchesStep", () => {
  it("matches names, type, path, endpoint, feature and props", () => {
    const event = ev({
      name: "api_call",
      type: "api_call",
      endpoint: "/api/auth/signup",
      props: { source: "banner", retries: 2 },
    })
    expect(matchesStep(event, { names: ["api_call"] })).toBe(true)
    expect(matchesStep(event, { type: "api_call" })).toBe(true)
    expect(matchesStep(event, { endpoint: "/api/auth/signup" })).toBe(true)
    expect(matchesStep(event, { endpoint: "/api/other" })).toBe(false)
    expect(matchesStep(event, { props: { source: "banner" } })).toBe(true)
    expect(matchesStep(event, { props: { source: "other" } })).toBe(false)
    expect(matchesStep(event, { props: { retries: 2 } })).toBe(true)
    expect(matchesStep(event, { props: { retries: 3 } })).toBe(false)
    expect(matchesStep(event, { props: { missing: 1 } })).toBe(false)
  })

  it("matches path via top-level field or props.path, and pathPrefix", () => {
    expect(
      matchesStep(ev({ name: "page_view", type: "page_view", path: "/docs" }), { path: "/docs" }),
    ).toBe(true)
    expect(
      matchesStep(ev({ name: "page_view", props: { path: "/docs/guide" } }), {
        pathPrefix: "/docs",
      }),
    ).toBe(true)
    expect(
      matchesStep(ev({ name: "page_view", props: { path: "/pricing" } }), { pathPrefix: "/docs" }),
    ).toBe(false)
    expect(matchesStep(ev({ name: "x" }), { path: "/docs" })).toBe(false)
  })

  it("matches feature via top-level field or props.feature", () => {
    expect(matchesStep(ev({ name: "f", feature: "search" }), { feature: "search" })).toBe(true)
    expect(
      matchesStep(ev({ name: "f", props: { feature: "search" } }), { feature: "search" }),
    ).toBe(true)
    expect(matchesStep(ev({ name: "f" }), { feature: "search" })).toBe(false)
  })

  it("anyOf requires at least one matcher", () => {
    const step = { id: "s", label: "S", anyOf: [{ names: ["alpha"] }, { names: ["beta"] }] }
    expect(matchesFunnelStep(ev({ name: "alpha" }), step)).toBe(true)
    expect(matchesFunnelStep(ev({ name: "beta" }), step)).toBe(true)
    expect(matchesFunnelStep(ev({ name: "nope" }), step)).toBe(false)
    expect(matchesFunnelStep(ev({ name: "other" }), step)).toBe(false)
  })
})

describe("actorKeyFor", () => {
  it("prefers actorId, falls back to anonymousId, then props.anonymousId", () => {
    expect(actorKeyFor(ev({ name: "x", actorId: "user:u1", anonymousId: "a" }))).toBe("user:u1")
    expect(actorKeyFor(ev({ name: "x", actorId: null, anonymousId: "a1" }))).toBe("anon:a1")
    expect(actorKeyFor(ev({ name: "x", actorId: null, props: { anonymousId: "p1" } }))).toBe(
      "anon:p1",
    )
    expect(actorKeyFor(ev({ name: "x", actorId: null }))).toBeNull()
  })
})

describe("analyzeFunnel", () => {
  it("computes reached, conversion, drop-off and overall conversion", () => {
    const events: FunnelEvent[] = [
      ev({ name: "step_a", actorId: "u1", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u1", timestamp: T0 + 5 * MIN }),
      ev({ name: "step_a", actorId: "u2", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u3", timestamp: T0 }), // b without a
    ]
    const report = analyzeFunnel(events, twoStep, { now: T0 })

    expect(report.totalActors).toBe(3)
    expect(report.steps[0]).toMatchObject({ reached: 2, entered: 2, dropOff: null })
    expect(report.steps[1]).toMatchObject({
      reached: 1,
      entered: 2,
      dropOff: 1,
      conversionFromPrevious: 0.5,
      conversionFromTop: 0.5,
      droppedHere: null,
    })
    expect(report.overallConversion).toBe(0.5)
  })

  it("requires step order — later events do not count for earlier steps", () => {
    const events: FunnelEvent[] = [
      ev({ name: "step_b", actorId: "u1", timestamp: T0 }),
      ev({ name: "step_a", actorId: "u1", timestamp: T0 + MIN }),
    ]
    const report = analyzeFunnel(events, twoStep)
    // b entered but no ordered a→b journey exists.
    expect(report.steps[0].reached).toBe(1)
    expect(report.steps[1].reached).toBe(0)
    expect(report.steps[1].entered).toBe(1)
    expect(report.overallConversion).toBe(0)
  })

  it("handles repeated events by taking the earliest ordered match", () => {
    const events: FunnelEvent[] = [
      ev({ name: "step_a", actorId: "u1", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u1", timestamp: T0 + 10 * MIN }),
      ev({ name: "step_a", actorId: "u1", timestamp: T0 + 20 * MIN }),
      ev({ name: "step_b", actorId: "u1", timestamp: T0 + 30 * MIN }),
    ]
    const report = analyzeFunnel(events, twoStep)
    expect(report.steps[1].reached).toBe(1)
    // Time a→b uses the first ordered pair (T0 → T0+10m).
    expect(report.steps[0].avgTimeToNextMs).toBe(10 * MIN)
    expect(report.steps[0].medianTimeToNextMs).toBe(10 * MIN)
  })

  it("enforces windowMs — steps outside the window do not count", () => {
    const funnel: FunnelDefinition = { ...twoStep, windowMs: 10 * MIN }
    const inside: FunnelEvent[] = [
      ev({ name: "step_a", actorId: "u1", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u1", timestamp: T0 + 5 * MIN }),
    ]
    const outside: FunnelEvent[] = [
      ev({ name: "step_a", actorId: "u2", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u2", timestamp: T0 + 30 * MIN }),
    ]
    const report = analyzeFunnel([...inside, ...outside], funnel)
    expect(report.steps[0].reached).toBe(2)
    expect(report.steps[1].reached).toBe(1)
    expect(report.windowMs).toBe(10 * MIN)
  })

  it("computes median and mean time-to-next across actors", () => {
    const events: FunnelEvent[] = [
      ev({ name: "step_a", actorId: "u1", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u1", timestamp: T0 + 10 * MIN }),
      ev({ name: "step_a", actorId: "u2", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u2", timestamp: T0 + 20 * MIN }),
      ev({ name: "step_a", actorId: "u3", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u3", timestamp: T0 + 30 * MIN }),
      ev({ name: "step_a", actorId: "u4", timestamp: T0 }), // drops
    ]
    const report = analyzeFunnel(events, twoStep)
    expect(report.steps[0].medianTimeToNextMs).toBe(20 * MIN)
    expect(report.steps[0].avgTimeToNextMs).toBe(20 * MIN)
    expect(report.steps[1].avgTimeToNextMs).toBeNull()
    expect(report.steps[0].droppedHere).toBe(1)
  })

  it("skips unattributed events and ignores non-matching actors", () => {
    const events: FunnelEvent[] = [
      ev({ name: "step_a", actorId: null, timestamp: T0 }),
      ev({ name: "unrelated", actorId: "u9", timestamp: T0 }),
      ev({ name: "step_a", actorId: "u1", timestamp: T0 }),
      ev({ name: "step_b", actorId: "u1", timestamp: T0 + MIN }),
    ]
    const report = analyzeFunnel(events, twoStep)
    expect(report.skippedEvents).toBe(1)
    expect(report.totalActors).toBe(1)
    expect(report.overallConversion).toBe(1)
  })

  it("returns null conversions on empty input", () => {
    const report = analyzeFunnel([], twoStep, { now: T0 })
    expect(report.totalActors).toBe(0)
    expect(report.overallConversion).toBeNull()
    expect(report.steps[0].conversionFromTop).toBeNull()
    expect(report.steps[1].conversionFromPrevious).toBeNull()
  })

  it("matches catalog funnels against realistic event shapes", () => {
    const signup: FunnelEvent[] = [
      { name: "page_view", type: "page_view", path: "/sign-up", timestamp: T0, actorId: "u1" },
      {
        name: "api_call",
        type: "api_call",
        endpoint: "/api/auth/signup",
        timestamp: T0 + MIN,
        actorId: "u1",
      },
      {
        name: "api_call",
        type: "api_call",
        endpoint: "/api/auth/verify-email",
        timestamp: T0 + 2 * MIN,
        actorId: "u1",
      },
      {
        name: "project_created",
        type: "feature_use",
        feature: "project_created",
        timestamp: T0 + 3 * MIN,
        actorId: "u1",
      },
      {
        name: "page_view",
        type: "page_view",
        path: "/dashboard",
        timestamp: T0 + 4 * MIN,
        actorId: "u1",
      },
    ]
    const report = analyzeFunnel(signup, getFunnel("signup_activation")!)
    expect(report.steps.map((s) => s.reached)).toEqual([1, 1, 1, 1, 1])
    expect(report.overallConversion).toBe(1)
  })
})

describe("catalog + demo data", () => {
  it("every funnel has unique step ids and at least two steps", () => {
    const ids = new Set(FUNNELS.map((f) => f.id))
    expect(ids.size).toBe(FUNNELS.length)
    for (const funnel of FUNNELS) {
      expect(funnel.steps.length).toBeGreaterThanOrEqual(2)
      const stepIds = funnel.steps.map((s) => s.id)
      expect(new Set(stepIds).size).toBe(stepIds.length)
      for (const step of funnel.steps) expect(step.anyOf.length).toBeGreaterThan(0)
    }
  })

  it("getFunnel resolves ids and returns undefined for unknown", () => {
    expect(getFunnel("signup_activation")?.id).toBe("signup_activation")
    expect(getFunnel("nope")).toBeUndefined()
  })

  it("demo events are deterministic and produce plausible reports", () => {
    const now = new Date("2025-06-01T12:00:00Z")
    const a = generateDemoFunnelEvents(now)
    const b = generateDemoFunnelEvents(now)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)

    const reports = analyzeFunnels(a, FUNNELS, { now: now.getTime() })
    expect(reports).toHaveLength(FUNNELS.length)
    for (const report of reports) {
      expect(report.totalActors).toBeGreaterThan(0)
      const reached = report.steps.map((s) => s.reached)
      // Reached counts are non-increasing along the funnel.
      for (let i = 1; i < reached.length; i += 1) {
        expect(reached[i]).toBeLessThanOrEqual(reached[i - 1])
      }
      expect(report.overallConversion).toBeGreaterThan(0)
      expect(report.overallConversion).toBeLessThanOrEqual(1)
    }
    // Unattributed demo events are counted, not silently merged.
    expect(reports[0].skippedEvents).toBe(5)
  })
})
