import { describe, expect, it } from "vitest"

import { assignVariant } from "./assign"
import { defineExperiment, getExperimentDefinition, listExperimentNames } from "./registry"
import type { ExperimentDefinition } from "./types"

const base: ExperimentDefinition = {
  name: "exp",
  description: "a test experiment",
  variants: [
    { name: "control", weight: 50 },
    { name: "treatment", weight: 50 },
  ],
}

describe("defineExperiment", () => {
  it("accepts a valid definition and defaults status to running", () => {
    const def = defineExperiment(base)
    expect(def.status).toBe("running")
    expect(def.name).toBe("exp")
  })

  it("rejects empty or over-long names", () => {
    expect(() => defineExperiment({ ...base, name: "" })).toThrow(/name/i)
    expect(() => defineExperiment({ ...base, name: "x".repeat(129) })).toThrow(/name/i)
  })

  it("requires a description", () => {
    expect(() => defineExperiment({ ...base, description: "  " })).toThrow(/description/i)
  })

  it("rejects empty variant lists and too many variants", () => {
    expect(() => defineExperiment({ ...base, variants: [] })).toThrow(/variants/i)
    const many = Array.from({ length: 17 }, (_, i) => ({ name: `v${i}`, weight: 1 }))
    expect(() => defineExperiment({ ...base, variants: many })).toThrow(/variants/i)
  })

  it("rejects duplicate variant names", () => {
    const def: ExperimentDefinition = {
      ...base,
      variants: [
        { name: "a", weight: 50 },
        { name: "a", weight: 50 },
      ],
    }
    expect(() => defineExperiment(def)).toThrow(/duplicate/i)
  })

  it("rejects out-of-range and non-finite weights", () => {
    for (const weight of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      const def: ExperimentDefinition = {
        ...base,
        variants: [{ name: "a", weight }],
      }
      expect(() => defineExperiment(def)).toThrow(/weight/i)
    }
  })

  it("rejects weights summing above 100", () => {
    const def: ExperimentDefinition = {
      ...base,
      variants: [
        { name: "a", weight: 60 },
        { name: "b", weight: 60 },
      ],
    }
    expect(() => defineExperiment(def)).toThrow(/sum/i)
  })

  it("allows weights summing below 100 (implicit control remainder)", () => {
    const def: ExperimentDefinition = {
      ...base,
      variants: [{ name: "treatment", weight: 30 }],
    }
    expect(() => defineExperiment(def)).not.toThrow()
  })

  it("rejects out-of-range traffic and unknown statuses", () => {
    expect(() => defineExperiment({ ...base, traffic: 101 })).toThrow(/traffic/i)
    expect(() => defineExperiment({ ...base, traffic: -5 })).toThrow(/traffic/i)
    expect(() =>
      defineExperiment({ ...base, status: "paused" as ExperimentDefinition["status"] }),
    ).toThrow(/status/i)
  })
})

describe("registry", () => {
  it("ships empty and lookups return undefined for unknown names", () => {
    expect(listExperimentNames()).toEqual([])
    expect(getExperimentDefinition("nope")).toBeUndefined()
  })

  it("defineExperiment output works with assignVariant", () => {
    const def = defineExperiment({ ...base, status: "stopped" })
    const a = assignVariant(def, { subjectId: "u1" })
    expect(a.variant).toBeNull()
    expect(a.reason).toBe("not-running")
  })
})
