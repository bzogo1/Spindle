import { describe, expect, it } from "vitest"

import {
  EXPERIMENT_TRANSITIONS,
  ExperimentTransitionError,
  createExperiment,
  isValidExperimentId,
  isValidTransition,
  normalizeVariant,
  transitionExperiment,
  validateExperiment,
} from "./tracking"
import type { ExperimentRecord } from "./tracking"

const T0 = new Date("2025-01-01T00:00:00.000Z")
const T1 = new Date("2025-01-02T00:00:00.000Z")
const T2 = new Date("2025-01-03T00:00:00.000Z")

function draft(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "checkout-button-copy",
    hypothesis: "Changing the CTA to 'Start free trial' increases signups",
    variants: [{ name: "control" }, { name: "treatment", weight: 50 }],
    status: "draft",
    owner: "growth-team",
    createdAt: T0.toISOString(),
    ...overrides,
  }
}

const conclusion = {
  result: "win" as const,
  summary: "Treatment beat control by 12% on signup conversion.",
  decidedAt: T2.toISOString(),
  metrics: [{ name: "signup-rate", value: 0.142, link: "https://metrics.example/signup" }],
}

describe("isValidExperimentId", () => {
  it("accepts lowercase slugs and rejects anything else", () => {
    expect(isValidExperimentId("checkout-button-copy")).toBe(true)
    expect(isValidExperimentId("a")).toBe(true)
    expect(isValidExperimentId("Bad_Id")).toBe(false)
    expect(isValidExperimentId("-leading-dash")).toBe(false)
    expect(isValidExperimentId("")).toBe(false)
    expect(isValidExperimentId("has space")).toBe(false)
  })
})

describe("EXPERIMENT_TRANSITIONS / isValidTransition", () => {
  it("matches the documented lifecycle", () => {
    expect(EXPERIMENT_TRANSITIONS.draft).toEqual(["running", "stopped"])
    expect(EXPERIMENT_TRANSITIONS.running).toEqual(["concluded", "stopped"])
    expect(EXPERIMENT_TRANSITIONS.stopped).toEqual(["running"])
    expect(EXPERIMENT_TRANSITIONS.concluded).toEqual([])
  })

  it("rejects illegal moves", () => {
    expect(isValidTransition("draft", "concluded")).toBe(false)
    expect(isValidTransition("draft", "draft")).toBe(false)
    expect(isValidTransition("running", "draft")).toBe(false)
    expect(isValidTransition("stopped", "concluded")).toBe(false)
    expect(isValidTransition("concluded", "running")).toBe(false)
    expect(isValidTransition("concluded", "stopped")).toBe(false)
  })
})

describe("validateExperiment", () => {
  it("accepts a well-formed draft", () => {
    expect(validateExperiment(draft())).toEqual([])
  })

  it("flags missing core fields", () => {
    const errors = validateExperiment({})
    expect(errors.join("\n")).toMatch(/id must be/)
    expect(errors.join("\n")).toMatch(/hypothesis is required/)
    expect(errors.join("\n")).toMatch(/owner is required/)
    expect(errors.join("\n")).toMatch(/status must be one of/)
    expect(errors.join("\n")).toMatch(/variants must be/)
  })

  it("requires at least two variants and unique names", () => {
    const one = draft({
      variants: [{ name: "only" }],
    })
    expect(validateExperiment(one).join("\n")).toMatch(/at least 2 variants/)

    const dup = draft({
      variants: [{ name: "a" }, { name: "a" }],
    })
    expect(validateExperiment(dup).join("\n")).toMatch(/duplicate variant name: a/)
  })

  it("rejects non-positive weights", () => {
    const bad = draft({
      variants: [{ name: "a" }, { name: "b", weight: 0 }],
    })
    expect(validateExperiment(bad).join("\n")).toMatch(/weight must be a positive number/)
  })

  it("requires timestamps for non-draft statuses", () => {
    const running = draft({ status: "running" })
    expect(validateExperiment(running).join("\n")).toMatch(/startedAt is required/)

    const runningOk = draft({ status: "running", startedAt: T1.toISOString() })
    expect(validateExperiment(runningOk)).toEqual([])

    const concluded = draft({ status: "concluded", concludedAt: T2.toISOString() })
    const concludedErrors = validateExperiment(concluded).join("\n")
    expect(concludedErrors).toMatch(/conclusion is required/)

    const stopped = draft({ status: "stopped" })
    expect(validateExperiment(stopped).join("\n")).toMatch(/stoppedAt is required/)
  })

  it("validates the conclusion payload", () => {
    const bad = draft({
      status: "concluded",
      concludedAt: T2.toISOString(),
      conclusion: { result: "maybe" as never, summary: "", decidedAt: "nope" },
    })
    expect(validateExperiment(bad).join("\n")).toMatch(/conclusion is required/)
  })
})

describe("normalizeVariant", () => {
  it("passes objects through and parses 'name:weight' strings", () => {
    expect(normalizeVariant("control")).toEqual({ name: "control" })
    expect(normalizeVariant("treatment:50")).toEqual({ name: "treatment", weight: 50 })
    expect(normalizeVariant({ name: "x", description: "d" })).toEqual({
      name: "x",
      description: "d",
    })
  })
})

describe("createExperiment", () => {
  it("creates a draft with createdAt set", () => {
    const e = createExperiment(
      {
        id: "new-exp",
        hypothesis: "H",
        owner: "team",
        variants: ["control", "treatment:50"],
      },
      T0,
    )
    expect(e.status).toBe("draft")
    expect(e.createdAt).toBe(T0.toISOString())
    expect(e.variants).toEqual([{ name: "control" }, { name: "treatment", weight: 50 }])
  })

  it("throws with all problems for bad input", () => {
    expect(() =>
      createExperiment({ id: "Bad", hypothesis: "", owner: "", variants: ["only"] }, T0),
    ).toThrow(/Invalid experiment/)
  })
})

describe("transitionExperiment", () => {
  it("walks the happy path draft -> running -> concluded", () => {
    const running = transitionExperiment(draft(), "running", { now: T1 })
    expect(running.status).toBe("running")
    expect(running.startedAt).toBe(T1.toISOString())
    // input not mutated
    expect(draft().status).toBe("draft")

    const concluded = transitionExperiment(running, "concluded", {
      now: T2,
      conclusion,
    })
    expect(concluded.status).toBe("concluded")
    expect(concluded.concludedAt).toBe(T2.toISOString())
    expect(concluded.conclusion).toEqual(conclusion)
    expect(validateExperiment(concluded)).toEqual([])
  })

  it("stamps stoppedAt and clears it on resume", () => {
    const running = transitionExperiment(draft(), "running", { now: T1 })
    const stopped = transitionExperiment(running, "stopped", { now: T2 })
    expect(stopped.stoppedAt).toBe(T2.toISOString())
    expect(validateExperiment(stopped)).toEqual([])

    const resumed = transitionExperiment(stopped, "running", {
      now: new Date("2025-01-04T00:00:00Z"),
    })
    expect(resumed.status).toBe("running")
    expect(resumed.stoppedAt).toBeUndefined()
    expect(validateExperiment(resumed)).toEqual([])
  })

  it("allows abandoning a draft via stopped", () => {
    const stopped = transitionExperiment(draft(), "stopped", { now: T1 })
    expect(stopped.status).toBe("stopped")
    expect(validateExperiment(stopped)).toEqual([])
  })

  it("throws ExperimentTransitionError for illegal moves", () => {
    expect(() => transitionExperiment(draft(), "concluded", { conclusion })).toThrow(
      ExperimentTransitionError,
    )
    expect(() => transitionExperiment(draft(), "concluded")).toThrow(
      /Invalid experiment transition: draft -> concluded/,
    )
  })

  it("requires a conclusion to conclude", () => {
    const running = transitionExperiment(draft(), "running", { now: T1 })
    expect(() => transitionExperiment(running, "concluded", { now: T2 })).toThrow(
      /requires a conclusion/,
    )
  })

  it("concluded is terminal", () => {
    const running = transitionExperiment(draft(), "running", { now: T1 })
    const concluded = transitionExperiment(running, "concluded", {
      now: T2,
      conclusion,
    })
    expect(() => transitionExperiment(concluded, "running")).toThrow(ExperimentTransitionError)
  })
})
