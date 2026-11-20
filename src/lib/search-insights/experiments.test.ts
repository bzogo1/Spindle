import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  assignVariant,
  clearExperimentAssignment,
  getExperiment,
  hashString,
  RANKING_EXPERIMENT,
  resetExperimentSessionForTests,
} from "./experiments"
import { flushEvents, onFlush, readStoredEvents, resetFlushQueueForTests } from "./store"

const EXP = {
  id: "test-exp",
  variants: [
    { id: "control", weight: 1 },
    { id: "treatment", weight: 3 },
  ],
}

describe("hashString / assignVariant", () => {
  it("hashString is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"))
    expect(hashString("abc")).not.toBe(hashString("abd"))
  })

  it("assignVariant is deterministic per anonId", () => {
    const a = assignVariant("exp", "user-1", EXP.variants)
    const b = assignVariant("exp", "user-1", EXP.variants)
    expect(a.id).toBe(b.id)
  })

  it("respects weights roughly (treatment gets ~75%)", () => {
    let treatment = 0
    const n = 2000
    for (let i = 0; i < n; i += 1) {
      if (assignVariant("exp", `user-${i}`, EXP.variants).id === "treatment") treatment += 1
    }
    const ratio = treatment / n
    expect(ratio).toBeGreaterThan(0.65)
    expect(ratio).toBeLessThan(0.85)
  })

  it("different experiment ids can bucket differently", () => {
    // Not guaranteed for every id, but across many ids some differ.
    const results = new Set(
      ["e1", "e2", "e3", "e4", "e5"].map((id) => assignVariant(id, "same-user", EXP.variants).id),
    )
    expect(results.size).toBeGreaterThan(1)
  })
})

describe("getExperiment", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetFlushQueueForTests()
    resetExperimentSessionForTests()
  })

  it("assigns a sticky variant and logs exposure once", () => {
    const first = getExperiment(EXP, { anonId: "u1", locale: "en" })
    expect(first.isNewAssignment).toBe(true)
    const second = getExperiment(EXP, { anonId: "u1", locale: "en" })
    expect(second.isNewAssignment).toBe(false)
    expect(second.variant.id).toBe(first.variant.id)

    const exposures = readStoredEvents().filter((e) => e.type === "experiment_exposure")
    expect(exposures).toHaveLength(1)
    expect(exposures[0]).toMatchObject({ experiment: "test-exp", variant: first.variant.id })
  })

  it("recordConversion emits experiment_conversion", () => {
    const active = getExperiment(EXP, { anonId: "u2" })
    active.recordConversion("result_clicked")
    const conversions = readStoredEvents().filter((e) => e.type === "experiment_conversion")
    expect(conversions).toHaveLength(1)
    expect(conversions[0]).toMatchObject({
      experiment: "test-exp",
      variant: active.variant.id,
      conversion: "result_clicked",
    })
  })

  it("clearExperimentAssignment forces re-assignment", () => {
    const first = getExperiment(EXP, { anonId: "u3" })
    clearExperimentAssignment(EXP.id)
    const second = getExperiment(EXP, { anonId: "u3" })
    expect(second.isNewAssignment).toBe(true)
    // Variant may be the same (deterministic hash) but exposure logs again.
    expect(second.variant.id).toBe(first.variant.id)
  })

  it("session cache keeps variant sticky and logs one exposure when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    const batches: { type?: string }[][] = []
    const unsub = onFlush((events) => batches.push([...events]))
    try {
      const first = getExperiment(EXP, { anonId: "u-no-storage" })
      const second = getExperiment(EXP, { anonId: "u-no-storage" })
      const third = getExperiment(EXP, { anonId: "u-no-storage" })
      // Sticky in-module even though localStorage writes throw.
      expect(second.variant.id).toBe(first.variant.id)
      expect(third.variant.id).toBe(first.variant.id)
      expect(second.isNewAssignment).toBe(false)
      expect(third.isNewAssignment).toBe(false)
      // Drain the flush queue (storage writes failed, so events only exist
      // in the pending-flush delivery path).
      flushEvents()
      // Exactly one exposure across all three calls.
      const exposures = batches.flat().filter((e) => e.type === "experiment_exposure")
      expect(exposures).toHaveLength(1)
    } finally {
      unsub()
      vi.restoreAllMocks()
    }
  })

  it("RANKING_EXPERIMENT payloads carry ranking overrides", () => {
    const active = getExperiment(RANKING_EXPERIMENT, { anonId: "rank-user" })
    expect(active.variant.id).toBeTruthy()
    if (active.variant.id === "control") {
      expect(active.variant.payload?.ranking).toBeUndefined()
    } else {
      expect(active.variant.payload?.ranking).toBeDefined()
    }
  })
})
