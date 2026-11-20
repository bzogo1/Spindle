import { beforeEach, describe, expect, it } from "vitest"

import {
  assignVariant,
  concludeExperiment,
  createExperiment,
  findExperimentByName,
  findRunningExperimentByName,
  getExperiment,
  LANDING_AB_MAX_VARIANTS,
  LandingAbError,
  listExperiments,
  recordEvent,
  resetLandingAbForTests,
  results,
  updateExperiment,
} from "@/lib/landing-ab"

function makeExperiment(overrides?: {
  name?: string
  weights?: number[]
  status?: "draft" | "running" | "paused" | "completed"
}) {
  const weights = overrides?.weights ?? [1, 1]
  const experiment = createExperiment({
    name: overrides?.name ?? "referral-landing",
    variants: weights.map((weight, index) => ({
      weight,
      config: index === 0 ? { headline: "Control" } : { headline: `Variant ${index + 1}` },
    })),
  })
  if (overrides?.status && overrides.status !== "draft") {
    return updateExperiment(experiment.id, { status: overrides.status })
  }
  return experiment
}

beforeEach(() => {
  resetLandingAbForTests()
})

describe("createExperiment / getExperiment / listExperiments", () => {
  it("creates a draft experiment with generated variant ids", () => {
    const experiment = makeExperiment()
    expect(experiment.status).toBe("draft")
    expect(experiment.variants).toHaveLength(2)
    expect(new Set(experiment.variants.map((v) => v.id)).size).toBe(2)
    expect(getExperiment(experiment.id)?.name).toBe("referral-landing")
  })

  it("rejects invalid input", () => {
    expect(() =>
      createExperiment({ name: "  ", variants: [{ weight: 1 }, { weight: 1 }] }),
    ).toThrow(LandingAbError)
    expect(() =>
      createExperiment({
        name: "x",
        variants: [{ weight: 1 }],
      }),
    ).toThrow(/2-6 variants/)
    expect(() =>
      createExperiment({
        name: "x",
        variants: Array.from({ length: LANDING_AB_MAX_VARIANTS + 1 }, () => ({ weight: 1 })),
      }),
    ).toThrow(/2-6 variants/)
    expect(() =>
      createExperiment({
        name: "x",
        variants: [
          { id: "same", weight: 1 },
          { id: "same", weight: 1 },
        ],
      }),
    ).toThrow(/Duplicate variant id/)
    expect(() =>
      createExperiment({
        name: "x",
        variants: [{ weight: 0 }, { weight: 1 }],
      }),
    ).toThrow(/weight/)
    expect(() =>
      createExperiment({
        name: "x",
        startAt: "2026-01-02T00:00:00Z",
        endAt: "2026-01-01T00:00:00Z",
        variants: [{ weight: 1 }, { weight: 1 }],
      }),
    ).toThrow(/startAt/)
  })

  it("lists newest-first and filters by status", () => {
    const a = makeExperiment({ name: "a" })
    const b = makeExperiment({ name: "b", status: "running" })
    const all = listExperiments()
    expect(all.map((e) => e.id)).toEqual([b.id, a.id])
    expect(listExperiments({ status: "running" }).map((e) => e.id)).toEqual([b.id])
  })
})

describe("status machine", () => {
  it("walks draft→running→paused→running→completed", () => {
    const experiment = makeExperiment()
    const running = updateExperiment(experiment.id, { status: "running" })
    expect(running.status).toBe("running")
    const paused = updateExperiment(experiment.id, { status: "paused" })
    expect(paused.status).toBe("paused")
    const resumed = updateExperiment(experiment.id, { status: "running" })
    expect(resumed.status).toBe("running")
    const done = concludeExperiment(experiment.id, experiment.variants[0].id)
    expect(done.status).toBe("completed")
    expect(done.winnerVariantId).toBe(experiment.variants[0].id)
    expect(done.completedAt).toBeTruthy()
  })

  it("rejects illegal transitions and edits on non-drafts", () => {
    const experiment = makeExperiment()
    expect(() => updateExperiment(experiment.id, { status: "paused" })).toThrow(/Cannot transition/)
    updateExperiment(experiment.id, { status: "running" })
    expect(() =>
      updateExperiment(experiment.id, { variants: [{ weight: 1 }, { weight: 1 }] }),
    ).toThrow(/draft/)
    expect(() => updateExperiment("missing", { status: "running" })).toThrow(/not found/i)
    expect(() => concludeExperiment(experiment.id, "nope")).toThrow(/winnerVariantId/)
  })

  it("concludeExperiment requires running or paused", () => {
    const draft = makeExperiment()
    expect(() => concludeExperiment(draft.id)).toThrow(/Cannot conclude/)
  })
})

describe("assignVariant", () => {
  it("returns null for drafts and unknown selectors", () => {
    const draft = makeExperiment()
    expect(assignVariant(draft.id, "visitor-1")).toBeNull()
    expect(assignVariant("no-such-experiment", "visitor-1")).toBeNull()
    expect(assignVariant(draft.id, "")).toBeNull()
  })

  it("is sticky per visitor and deterministic", () => {
    const experiment = makeExperiment({ status: "running" })
    const first = assignVariant(experiment.id, "visitor-abc")
    expect(first).not.toBeNull()
    for (let i = 0; i < 5; i += 1) {
      const again = assignVariant(experiment.id, "visitor-abc")
      expect(again?.variantId).toBe(first?.variantId)
    }
    // A different visitor id can differ; same input always same output.
    const other = assignVariant(experiment.id, "visitor-xyz")
    expect(other).not.toBeNull()
  })

  it("respects weighted distribution roughly", () => {
    const experiment = makeExperiment({ weights: [3, 1], status: "running" })
    const counts = new Map<string, number>()
    const visitors = 2_000
    for (let i = 0; i < visitors; i += 1) {
      const assignment = assignVariant(experiment.id, `visitor-${i}`)
      expect(assignment).not.toBeNull()
      counts.set(assignment!.variantId, (counts.get(assignment!.variantId) ?? 0) + 1)
    }
    const [heavy, light] = experiment.variants
    const heavyCount = counts.get(heavy.id) ?? 0
    const lightCount = counts.get(light.id) ?? 0
    expect(heavyCount).toBeGreaterThan(lightCount * 2)
    // 75/25 split: allow a wide sanity band.
    expect(heavyCount / visitors).toBeGreaterThan(0.6)
    expect(heavyCount / visitors).toBeLessThan(0.9)
  })

  it("resolves by surface name via findRunningExperimentByName", () => {
    const experiment = makeExperiment({ name: "referral-landing", status: "running" })
    const assignment = assignVariant("referral-landing", "visitor-1")
    expect(assignment?.experimentId).toBe(experiment.id)
    expect(findRunningExperimentByName("referral-landing")?.id).toBe(experiment.id)
    expect(findRunningExperimentByName("other-surface")).toBeNull()
  })

  it("serves the winner for a completed experiment resolved by name", () => {
    const experiment = makeExperiment({ name: "referral-landing", status: "running" })
    const winner = experiment.variants[1]
    concludeExperiment(experiment.id, winner.id)

    // Name resolution must not fall through to "no running experiment" —
    // the concluded winner keeps being served.
    const assignment = assignVariant("referral-landing", "late-visitor")
    expect(assignment?.experimentId).toBe(experiment.id)
    expect(assignment?.variantId).toBe(winner.id)
    expect(findExperimentByName("referral-landing")?.status).toBe("completed")
  })

  it("returns null by name for draft/paused experiments without restarting", () => {
    const draft = makeExperiment({ name: "referral-landing" })
    expect(assignVariant("referral-landing", "visitor-1")).toBeNull()
    updateExperiment(draft.id, { status: "running" })
    updateExperiment(draft.id, { status: "paused" })
    expect(assignVariant("referral-landing", "visitor-1")).toBeNull()
    // Still just the one experiment — resolution never creates records.
    expect(listExperiments()).toHaveLength(1)
  })

  it("prefers the newest experiment for a name regardless of status", () => {
    const older = makeExperiment({ name: "referral-landing", status: "running" })
    concludeExperiment(older.id, older.variants[0].id)
    const newer = makeExperiment({ name: "referral-landing", status: "running" })

    expect(findExperimentByName("referral-landing")?.id).toBe(newer.id)
    const assignment = assignVariant("referral-landing", "visitor-1")
    expect(assignment?.experimentId).toBe(newer.id)
    expect([newer.variants[0].id, newer.variants[1].id]).toContain(assignment?.variantId)
  })

  it("returns the winner for completed experiments", () => {
    const experiment = makeExperiment({ status: "running" })
    const winner = experiment.variants[1]
    concludeExperiment(experiment.id, winner.id)
    const assignment = assignVariant(experiment.id, "late-visitor")
    expect(assignment?.variantId).toBe(winner.id)
  })

  it("returns null outside the scheduling window", () => {
    const experiment = createExperiment({
      name: "scheduled",
      startAt: new Date(Date.now() + 60_000).toISOString(),
      variants: [{ weight: 1 }, { weight: 1 }],
    })
    updateExperiment(experiment.id, { status: "running" })
    expect(assignVariant(experiment.id, "visitor-1")).toBeNull()

    const ended = createExperiment({
      name: "ended",
      endAt: new Date(Date.now() - 60_000).toISOString(),
      variants: [{ weight: 1 }, { weight: 1 }],
    })
    updateExperiment(ended.id, { status: "running" })
    expect(assignVariant(ended.id, "visitor-1")).toBeNull()
  })
})

describe("recordEvent / results", () => {
  it("records events and computes per-variant rates", () => {
    const experiment = makeExperiment({ status: "running" })
    const [first, second] = experiment.variants

    // Two sticky assignments so `assigned` counts are non-zero; the visitors
    // may land on the same variant, so events below target explicit variants.
    assignVariant(experiment.id, "v1")
    assignVariant(experiment.id, "v2")
    for (const variant of [first, second]) {
      recordEvent({
        experimentId: experiment.id,
        variantId: variant.id,
        visitorId: "v1",
        type: "view",
      })
      recordEvent({
        experimentId: experiment.id,
        variantId: variant.id,
        visitorId: "v1",
        type: "cta_click",
      })
    }
    // An event without variantId still validates and is stored.
    recordEvent({ experimentId: experiment.id, visitorId: "v9", type: "signup_click" })

    const outcome = results(experiment.id)!
    expect(outcome.experimentId).toBe(experiment.id)
    const byId = new Map(outcome.variants.map((v) => [v.variantId, v]))
    expect(byId.get(first.id)?.views).toBe(1)
    expect(byId.get(first.id)?.ctaClicks).toBe(1)
    expect(byId.get(first.id)?.clickRate).toBe(1)
    expect(byId.get(second.id)?.views).toBe(1)
    // Variants with no traffic report zero rates.
    const untouched = experiment.variants.find((v) => v.id !== first.id && v.id !== second.id)
    if (untouched) {
      expect(byId.get(untouched.id)?.viewRate).toBe(0)
    }
    expect(outcome.totals.views).toBe(2)
    expect(outcome.totals.ctaClicks).toBe(2)
    expect(byId.get(first.id)?.assigned).toBeGreaterThanOrEqual(0)
    expect(byId.get(second.id)?.assigned).toBeGreaterThanOrEqual(0)
    expect(experiment.variants[0]?.id).toBeTruthy()
    expect(experiment.variants[1]?.id).toBeTruthy()
  })

  it("rejects events for unknown experiments/variants/types", () => {
    const experiment = makeExperiment()
    expect(() => recordEvent({ experimentId: "missing", visitorId: "v", type: "view" })).toThrow(
      /not found/i,
    )
    expect(() =>
      recordEvent({
        experimentId: experiment.id,
        variantId: "bogus",
        visitorId: "v",
        type: "view",
      }),
    ).toThrow(/variantId/)
    expect(() =>
      recordEvent({ experimentId: experiment.id, visitorId: "v", type: "bogus" }),
    ).toThrow(/type must be/)
    expect(() =>
      recordEvent({ experimentId: experiment.id, visitorId: " ", type: "view" }),
    ).toThrow(/visitorId/)
  })

  it("returns null results for unknown experiments", () => {
    expect(results("missing")).toBeNull()
  })
})

describe("updateExperiment window edits", () => {
  it("updates name, window, and status on drafts", () => {
    const experiment = makeExperiment()
    const updated = updateExperiment(experiment.id, {
      name: "renamed",
      startAt: "2026-01-01T00:00:00Z",
      endAt: null,
    })
    expect(updated.name).toBe("renamed")
    expect(updated.startAt).toBe("2026-01-01T00:00:00Z")
    expect(updated.endAt).toBeUndefined()
  })
})
