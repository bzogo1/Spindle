import { describe, expect, it } from "vitest"

import { hashBucket, inCohort } from "./hash"
import { linearPercentAt, linearStrategy } from "./linear"
import { killSwitchStrategy } from "./kill-switch"
import { percentageStrategy } from "./percentage"
import { evaluateRollout, registerRolloutStrategy, rolloutStrategies } from "./registry"
import { scheduleStrategy } from "./schedule"
import { segmentStrategy } from "./segment"
import type { EvaluationContext, StrategyFn } from "./types"

const NOW = new Date("2025-06-15T12:00:00Z")

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return { flagKey: "test-flag", ...overrides }
}

/** Find cohort ids that fall inside a percentage rollout. */
function idsInside(percent: number, count = 200): { inside: string[]; outside: string[] } {
  const inside: string[] = []
  const outside: string[] = []
  for (let i = 0; i < count; i++) {
    const id = `user-${i}`
    ;(inCohort(ctx({ cohort: id }), percent) ? inside : outside).push(id)
  }
  return { inside, outside }
}

describe("hashBucket / inCohort", () => {
  it("is deterministic and bounded", () => {
    expect(hashBucket("a")).toBe(hashBucket("a"))
    expect(hashBucket("a")).not.toBe(hashBucket("b"))
    for (let i = 0; i < 100; i++) {
      const b = hashBucket(`input-${i}`)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(10_000)
    }
  })

  it("boundary percentages: 0 enables nobody, 100 enables everybody", () => {
    for (const cohort of ["a", "b", "c", null]) {
      expect(inCohort(ctx({ cohort }), 0)).toBe(false)
      expect(inCohort(ctx({ cohort }), -5)).toBe(false)
      expect(inCohort(ctx({ cohort }), 100)).toBe(true)
      expect(inCohort(ctx({ cohort }), 150)).toBe(true)
    }
  })

  it("is stable per flagKey and salt, and varies across them", () => {
    const base = ctx({ cohort: "user-42" })
    expect(inCohort({ ...base, flagKey: "flag-a" }, 50)).toBe(
      inCohort({ ...base, flagKey: "flag-a" }, 50),
    )
    // Across enough flags/salts the answer should vary — sanity check that
    // flagKey and salt actually feed the hash.
    const variants = new Set(
      ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map((flagKey) =>
        inCohort({ ...base, flagKey }, 50),
      ),
    )
    expect(variants.size).toBeGreaterThan(1)
  })

  it("falls back through attributes to a shared anonymous bucket", () => {
    const byAttr = inCohort(ctx({ attributes: { userId: "attr-user" } }), 50)
    expect(byAttr).toBe(inCohort(ctx({ attributes: { userId: "attr-user" } }), 50))
    // Two different anonymous contexts share one bucket.
    const anon1 = inCohort(ctx({}), 50)
    const anon2 = inCohort(ctx({ attributes: {} }), 50)
    expect(anon1).toBe(anon2)
  })

  it("subjectId acts as a cohort alias", () => {
    expect(inCohort(ctx({ subjectId: "subj-1" }), 50)).toBe(inCohort(ctx({ cohort: "subj-1" }), 50))
    // cohort wins when both are set.
    expect(inCohort(ctx({ cohort: "c", subjectId: "s" }), 50)).toBe(
      inCohort(ctx({ cohort: "c" }), 50),
    )
  })
})

describe("percentageStrategy", () => {
  it("0% disables everyone, 100% enables everyone", () => {
    for (const cohort of ["u1", "u2", "u3"]) {
      expect(percentageStrategy({ percent: 0 }, ctx({ cohort }), NOW).verdict).toBe(false)
      expect(percentageStrategy({ percent: 100 }, ctx({ cohort }), NOW).verdict).toBe(true)
    }
  })

  it("splits a cohort roughly in half at 50% and is deterministic", () => {
    const { inside, outside } = idsInside(50)
    expect(inside.length).toBeGreaterThan(60)
    expect(inside.length).toBeLessThan(140)
    expect(outside.length).toBeGreaterThan(60)

    const sample = inside[0]
    const first = percentageStrategy({ percent: 50 }, ctx({ cohort: sample }), NOW)
    const second = percentageStrategy({ percent: 50 }, ctx({ cohort: sample }), NOW)
    expect(first).toEqual(second)
    expect(first.verdict).toBe(true)
  })

  it("salt changes bucketing", () => {
    const someUser = "user-7"
    const results = new Set(
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map(
        (salt) => percentageStrategy({ percent: 50, salt }, ctx({ cohort: someUser }), NOW).verdict,
      ),
    )
    expect(results.size).toBeGreaterThan(1)
  })

  it("throws on malformed config", () => {
    expect(() => percentageStrategy(null, ctx(), NOW)).toThrow(TypeError)
    expect(() => percentageStrategy({}, ctx(), NOW)).toThrow(TypeError)
    expect(() => percentageStrategy({ percent: "50" }, ctx(), NOW)).toThrow(TypeError)
  })
})

describe("segmentStrategy", () => {
  it("matches plan, env, cohort allowlist and attributes (AND semantics)", () => {
    const config = {
      plans: ["pro", "enterprise"],
      envs: ["production"],
      cohorts: ["beta-1"],
      attributes: { region: ["eu", "us"] },
    }
    const good = ctx({
      plan: "pro",
      env: "production",
      cohort: "beta-1",
      attributes: { region: "eu" },
    })
    expect(segmentStrategy(config, good, NOW).verdict).toBe(true)

    expect(segmentStrategy(config, ctx({ ...good, plan: "free" }), NOW).verdict).toBe(false)
    expect(segmentStrategy(config, ctx({ ...good, env: "staging" }), NOW).verdict).toBe(false)
    expect(segmentStrategy(config, ctx({ ...good, cohort: "beta-2" }), NOW).verdict).toBe(false)
    expect(
      segmentStrategy(config, ctx({ ...good, attributes: { region: "ap" } }), NOW).verdict,
    ).toBe(false)
  })

  it("supports gradual cohortPercent rollout", () => {
    const { inside } = idsInside(30)
    expect(segmentStrategy({ cohortPercent: 30 }, ctx({ cohort: inside[0] }), NOW).verdict).toBe(
      true,
    )
    const { outside } = idsInside(30)
    expect(segmentStrategy({ cohortPercent: 30 }, ctx({ cohort: outside[0] }), NOW).verdict).toBe(
      false,
    )
  })

  it("abstains when no criteria are configured", () => {
    expect(segmentStrategy({}, ctx(), NOW).verdict).toBeNull()
  })

  it("throws on malformed config", () => {
    expect(() => segmentStrategy(null, ctx(), NOW)).toThrow(TypeError)
    expect(() => segmentStrategy({ plans: "pro" }, ctx(), NOW)).toThrow(TypeError)
    expect(() => segmentStrategy({ cohortPercent: "x" }, ctx(), NOW)).toThrow(TypeError)
  })
})

describe("scheduleStrategy", () => {
  const daily = {
    windows: [{ start: "09:00", end: "17:00", timezone: "UTC" }],
  }

  it("enables inside a one-off window, start inclusive / end exclusive", () => {
    const config = {
      windows: [{ startAt: "2025-06-01T00:00:00Z", endAt: "2025-07-01T00:00:00Z" }],
    }
    expect(scheduleStrategy(config, ctx(), new Date("2025-06-01T00:00:00Z")).verdict).toBe(true)
    expect(scheduleStrategy(config, ctx(), new Date("2025-06-15T12:00:00Z")).verdict).toBe(true)
    expect(scheduleStrategy(config, ctx(), new Date("2025-07-01T00:00:00Z")).verdict).toBe(false)
    expect(scheduleStrategy(config, ctx(), new Date("2025-05-31T23:59:59Z")).verdict).toBe(false)
  })

  it("matches daily windows in the configured timezone", () => {
    // 12:00Z is 15:00 in Kyiv (UTC+3 in June) and 08:00 in New York (UTC-4).
    const kyiv = { windows: [{ start: "09:00", end: "17:00", timezone: "Europe/Kyiv" }] }
    const ny = { windows: [{ start: "09:00", end: "17:00", timezone: "America/New_York" }] }
    expect(scheduleStrategy(kyiv, ctx(), NOW).verdict).toBe(true)
    expect(scheduleStrategy(ny, ctx(), NOW).verdict).toBe(false)
    expect(scheduleStrategy(daily, ctx(), NOW).verdict).toBe(true) // 12:00 UTC inside
  })

  it("handles overnight windows that wrap past midnight", () => {
    const config = { windows: [{ start: "22:00", end: "02:00", timezone: "UTC" }] }
    expect(scheduleStrategy(config, ctx(), new Date("2025-01-10T23:30:00Z")).verdict).toBe(true)
    expect(scheduleStrategy(config, ctx(), new Date("2025-01-11T01:00:00Z")).verdict).toBe(true)
    expect(scheduleStrategy(config, ctx(), new Date("2025-01-11T12:00:00Z")).verdict).toBe(false)
    // Boundary: end is exclusive.
    expect(scheduleStrategy(config, ctx(), new Date("2025-01-11T02:00:00Z")).verdict).toBe(false)
  })

  it("respects the days filter (0=Sunday … 6=Saturday)", () => {
    // 2025-01-06 is a Monday.
    const monday = new Date("2025-01-06T12:00:00Z")
    const config = {
      windows: [{ start: "00:00", end: "23:59", timezone: "UTC", days: [1] }],
    }
    expect(scheduleStrategy(config, ctx(), monday).verdict).toBe(true)
    const tuesdayOnly = {
      windows: [{ start: "00:00", end: "23:59", timezone: "UTC", days: [2] }],
    }
    expect(scheduleStrategy(tuesdayOnly, ctx(), monday).verdict).toBe(false)
  })

  it("follows wall-clock time across DST transitions", () => {
    // US DST spring-forward: 2025-03-09, 02:00 EST → 03:00 EDT.
    const config = {
      windows: [{ start: "09:00", end: "17:00", timezone: "America/New_York" }],
    }
    // Same UTC instant is 08:30 EST in January (outside) but 10:30 EDT in June (inside).
    expect(scheduleStrategy(config, ctx(), new Date("2025-01-15T13:30:00Z")).verdict).toBe(false)
    expect(scheduleStrategy(config, ctx(), new Date("2025-06-15T13:30:00Z")).verdict).toBe(true)
    // On the transition day itself, 14:00Z is already 10:00 EDT.
    expect(scheduleStrategy(config, ctx(), new Date("2025-03-09T14:00:00Z")).verdict).toBe(true)
  })

  it("a nonexistent wall-clock time (spring forward) simply never matches", () => {
    // 02:30 does not exist on 2025-03-09 in New York; at 07:15Z local time
    // is already 03:15 EDT, outside a 02:00–02:45 window.
    const config = {
      windows: [{ start: "02:00", end: "02:45", timezone: "America/New_York" }],
    }
    expect(scheduleStrategy(config, ctx(), new Date("2025-03-09T07:15:00Z")).verdict).toBe(false)
  })

  it("abstains with no windows and throws on malformed config", () => {
    expect(scheduleStrategy({ windows: [] }, ctx(), NOW).verdict).toBeNull()
    expect(() => scheduleStrategy(null, ctx(), NOW)).toThrow(TypeError)
    expect(() => scheduleStrategy({}, ctx(), NOW)).toThrow(TypeError)
    expect(() => scheduleStrategy({ windows: [{ start: "9am", end: "5pm" }] }, ctx(), NOW)).toThrow(
      TypeError,
    )
    expect(() =>
      scheduleStrategy({ windows: [{ startAt: "nope", endAt: "alsono" }] }, ctx(), NOW),
    ).toThrow(TypeError)
  })
})

describe("linearStrategy", () => {
  const ramp = {
    startAt: "2025-01-01T00:00:00Z",
    endAt: "2025-01-11T00:00:00Z", // 10 days
  }

  it("computes interpolated percentages at ramp boundaries", () => {
    expect(linearPercentAt(ramp, new Date("2024-12-31T00:00:00Z"))).toBe(0)
    expect(linearPercentAt(ramp, new Date("2025-01-06T00:00:00Z"))).toBeCloseTo(50)
    expect(linearPercentAt(ramp, new Date("2025-01-11T00:00:00Z"))).toBe(100)
    expect(linearPercentAt(ramp, new Date("2025-01-08T12:00:00Z"))).toBeCloseTo(75)
  })

  it("honors custom start/end percents", () => {
    const cfg = { ...ramp, startPercent: 20, endPercent: 80 }
    expect(linearPercentAt(cfg, new Date("2024-12-31T00:00:00Z"))).toBe(20)
    expect(linearPercentAt(cfg, new Date("2025-01-06T00:00:00Z"))).toBeCloseTo(50)
    expect(linearPercentAt(cfg, new Date("2025-01-12T00:00:00Z"))).toBe(80)
  })

  it("widens the enabled cohort monotonically over time", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `user-${i}`)
    const at = (iso: string) =>
      ids.filter((id) => linearStrategy(ramp, ctx({ cohort: id }), new Date(iso)).verdict === true)

    const early = at("2025-01-02T00:00:00Z") // 10%
    const mid = at("2025-01-06T00:00:00Z") // 50%
    const late = at("2025-01-10T12:00:00Z") // 95%

    expect(early.length).toBeLessThan(mid.length)
    expect(mid.length).toBeLessThan(late.length)
    // Buckets never lose access as the ramp widens.
    for (const id of early) expect(mid).toContain(id)
    for (const id of mid) expect(late).toContain(id)
  })

  it("returns verdicts with phase reasons", () => {
    const before = linearStrategy(ramp, ctx({ cohort: "user-0" }), new Date("2024-12-01T00:00:00Z"))
    expect(before.verdict).toBe(false)
    expect(before.reason).toContain("before ramp start")
  })

  it("throws on invalid config", () => {
    expect(() => linearStrategy(null, ctx(), NOW)).toThrow(TypeError)
    expect(() => linearStrategy({ startAt: "x", endAt: "y" }, ctx(), NOW)).toThrow(TypeError)
    expect(() =>
      linearStrategy(
        { startAt: "2025-02-01T00:00:00Z", endAt: "2025-01-01T00:00:00Z" },
        ctx(),
        NOW,
      ),
    ).toThrow(TypeError)
  })
})

describe("killSwitchStrategy", () => {
  it("triggers on boolean/object config or ctx.killSwitch", () => {
    expect(killSwitchStrategy(true, ctx(), NOW).verdict).toBe(false)
    expect(killSwitchStrategy({ disabled: true }, ctx(), NOW).verdict).toBe(false)
    expect(killSwitchStrategy(undefined, ctx({ killSwitch: true }), NOW).verdict).toBe(false)
    expect(killSwitchStrategy({ disabled: false }, ctx(), NOW).verdict).toBeNull()
    expect(killSwitchStrategy(undefined, ctx(), NOW).verdict).toBeNull()
    expect(killSwitchStrategy(false, ctx({ killSwitch: true }), NOW).verdict).toBe(false)
  })

  it("throws on malformed config", () => {
    expect(() => killSwitchStrategy("yes", ctx(), NOW)).toThrow(TypeError)
    expect(() => killSwitchStrategy({ disabled: "yes" }, ctx(), NOW)).toThrow(TypeError)
  })
})

describe("evaluateRollout (composer)", () => {
  it("ANDs strategies: schedule AND percentage", () => {
    const plan = {
      steps: [
        {
          strategy: "schedule",
          config: { windows: [{ start: "00:00", end: "23:59", timezone: "UTC" }] },
        },
        { strategy: "percentage", config: { percent: 100 } },
      ],
    }
    expect(evaluateRollout(plan, ctx(), NOW).enabled).toBe(true)

    const outsideSchedule = {
      steps: [
        {
          strategy: "schedule",
          config: { windows: [{ startAt: "2020-01-01T00:00:00Z", endAt: "2020-01-02T00:00:00Z" }] },
        },
        { strategy: "percentage", config: { percent: 100 } },
      ],
    }
    const result = evaluateRollout(outsideSchedule, ctx(), NOW)
    expect(result.enabled).toBe(false)
    // Short-circuit: the percentage step never ran.
    expect(result.results.map((r) => r.strategy)).toEqual(["schedule"])
  })

  it("abstentions do not disable the flag", () => {
    const plan = {
      steps: [
        { strategy: "segment", config: {} }, // abstains
        { strategy: "percentage", config: { percent: 100 } },
      ],
    }
    const result = evaluateRollout(plan, ctx(), NOW)
    expect(result.enabled).toBe(true)
    expect(result.results[0].verdict).toBeNull()
  })

  it("plan.killSwitch disables before any strategy runs", () => {
    const plan = {
      killSwitch: true,
      steps: [{ strategy: "percentage", config: { percent: 100 } }],
    }
    const result = evaluateRollout(plan, ctx(), NOW)
    expect(result.enabled).toBe(false)
    expect(result.results[0].strategy).toBe("kill-switch")
  })

  it("ctx.killSwitch has the same highest precedence", () => {
    const plan = { steps: [{ strategy: "percentage", config: { percent: 100 } }] }
    expect(evaluateRollout(plan, ctx({ killSwitch: true }), NOW).enabled).toBe(false)
    expect(evaluateRollout(plan, ctx(), NOW).enabled).toBe(true)
  })

  it("a kill-switch step placed first disables later steps", () => {
    const spy: StrategyFn = () => {
      throw new Error("should not be evaluated")
    }
    const result = evaluateRollout(
      {
        steps: [
          { strategy: "kill-switch", config: true },
          { strategy: "spy", config: {} },
        ],
      },
      ctx(),
      NOW,
      { spy },
    )
    expect(result.enabled).toBe(false)
    expect(result.results.map((r) => r.strategy)).toEqual(["kill-switch"])
  })

  it("throws on unknown strategies", () => {
    expect(() => evaluateRollout({ steps: [{ strategy: "does-not-exist" }] }, ctx(), NOW)).toThrow(
      /Unknown rollout strategy/,
    )
  })

  it("supports registering custom strategies", () => {
    const name = `test-strategy-${Date.now()}`
    registerRolloutStrategy(name, () => ({ verdict: true, reason: "custom" }))
    const result = evaluateRollout({ steps: [{ strategy: name }] }, ctx(), NOW)
    expect(result.enabled).toBe(true)
    expect(result.results[0].reason).toBe("custom")
    delete rolloutStrategies[name]
  })
})
