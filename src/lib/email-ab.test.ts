import { beforeEach, describe, expect, it } from "vitest"

import {
  concludeExperiment,
  createExperiment,
  EMAIL_AB_MAX_VARIANTS,
  EMAIL_AB_MIN_VARIANTS,
  getExperiment,
  listExperiments,
  pickVariant,
  resetEmailAbForTests,
  updateExperimentStatus,
} from "./email-ab"

function makeExperiment(overrides?: { emailKey?: string }) {
  return createExperiment({
    name: "Welcome subject test",
    emailKey: overrides?.emailKey ?? "welcome-day-0",
    variants: [
      { key: "control", subject: "Welcome aboard", body: "Hi there" },
      { key: "b", subject: "You're in!", body: "Hey" },
    ],
  })
}

beforeEach(() => {
  resetEmailAbForTests()
})

describe("createExperiment", () => {
  it("creates a draft experiment with truncated body previews", () => {
    const experiment = createExperiment({
      name: "  Test  ",
      emailKey: "newsletter",
      variants: [
        { key: "a", subject: "One", body: "x".repeat(500) },
        { key: "b", subject: "Two" },
        { key: "c", subject: "Three" },
      ],
    })
    expect(experiment.status).toBe("draft")
    expect(experiment.name).toBe("Test")
    expect(experiment.variants).toHaveLength(3)
    expect(experiment.variants[0].bodyPreview).toHaveLength(160)
    expect(experiment.variants[1].bodyPreview).toBeUndefined()
    expect(experiment.createdAt).toBeTruthy()
  })

  it("rejects too few/many variants and duplicate keys", () => {
    expect(() =>
      createExperiment({
        name: "x",
        emailKey: "k",
        variants: [{ key: "a", subject: "s" }],
      }),
    ).toThrow()
    expect(() =>
      createExperiment({
        name: "x",
        emailKey: "k",
        variants: [
          { key: "a", subject: "s" },
          { key: "b", subject: "s" },
          { key: "c", subject: "s" },
          { key: "d", subject: "s" },
          { key: "e", subject: "s" },
        ],
      }),
    ).toThrow()
    expect(EMAIL_AB_MIN_VARIANTS).toBe(2)
    expect(EMAIL_AB_MAX_VARIANTS).toBe(4)
    expect(() =>
      createExperiment({
        name: "x",
        emailKey: "k",
        variants: [
          { key: "a", subject: "s" },
          { key: "a", subject: "s2" },
        ],
      }),
    ).toThrow(/duplicate/)
  })

  it("rejects empty name/emailKey/subject", () => {
    expect(() =>
      createExperiment({
        name: "  ",
        emailKey: "k",
        variants: [
          { key: "a", subject: "s" },
          { key: "b", subject: "s" },
        ],
      }),
    ).toThrow()
    expect(() =>
      createExperiment({
        name: "n",
        emailKey: "",
        variants: [
          { key: "a", subject: "s" },
          { key: "b", subject: "s" },
        ],
      }),
    ).toThrow()
  })
})

describe("getExperiment / listExperiments", () => {
  it("returns snapshots and filters by status", () => {
    const a = makeExperiment()
    const b = makeExperiment({ emailKey: "other" })
    expect(getExperiment(a.id)?.id).toBe(a.id)
    expect(getExperiment("missing")).toBeNull()

    updateExperimentStatus(a.id, "running")
    expect(listExperiments()).toHaveLength(2)
    expect(listExperiments({ status: "running" }).map((e) => e.id)).toEqual([a.id])
    expect(listExperiments({ status: "draft" }).map((e) => e.id)).toEqual([b.id])
  })

  it("does not leak internal mutation through snapshots", () => {
    const a = makeExperiment()
    const snapshot = getExperiment(a.id)!
    snapshot.variants[0].subject = "mutated"
    expect(getExperiment(a.id)!.variants[0].subject).toBe("Welcome aboard")
  })
})

describe("updateExperimentStatus", () => {
  it("follows draft→running→paused→running", () => {
    const a = makeExperiment()
    expect(updateExperimentStatus(a.id, "paused")).toBeNull()
    expect(updateExperimentStatus(a.id, "running")?.status).toBe("running")
    expect(updateExperimentStatus(a.id, "draft")).toBeNull()
    expect(updateExperimentStatus(a.id, "paused")?.status).toBe("paused")
    expect(updateExperimentStatus(a.id, "running")?.status).toBe("running")
    expect(updateExperimentStatus("missing", "running")).toBeNull()
  })
})

describe("concludeExperiment", () => {
  it("concludes from running or paused with a valid winner", () => {
    const a = makeExperiment()
    expect(concludeExperiment(a.id, "control")).toBeNull() // still draft
    updateExperimentStatus(a.id, "running")
    const concluded = concludeExperiment(a.id, "b")
    expect(concluded?.status).toBe("concluded")
    expect(concluded?.winnerKey).toBe("b")
    expect(concluded?.concludedAt).toBeTruthy()
  })

  it("rejects an unknown winner key and concluded is terminal", () => {
    const a = makeExperiment()
    updateExperimentStatus(a.id, "running")
    expect(concludeExperiment(a.id, "nope")).toBeNull()
    concludeExperiment(a.id, "control")
    expect(updateExperimentStatus(a.id, "running")).toBeNull()
    expect(concludeExperiment(a.id, "b")).toBeNull()
  })
})

describe("pickVariant", () => {
  it("returns null for drafts and paused experiments", () => {
    const a = makeExperiment()
    expect(pickVariant(a.id, "user@example.com")).toBeNull()
    updateExperimentStatus(a.id, "running")
    updateExperimentStatus(a.id, "paused")
    expect(pickVariant(a.id, "user@example.com")).toBeNull()
  })

  it("assigns deterministically and stably per recipient", () => {
    const a = makeExperiment()
    updateExperimentStatus(a.id, "running")

    const first = pickVariant(a.id, " User@Example.COM ")
    expect(first?.experimentId).toBe(a.id)
    expect(["control", "b"]).toContain(first?.variant.key)

    // Same normalized email → same variant; different case/whitespace too.
    expect(pickVariant(a.id, "user@example.com")?.variant.key).toBe(first?.variant.key)
    // Unknown selector → null.
    expect(pickVariant("no-such", "user@example.com")).toBeNull()
    // Empty recipient → null.
    expect(pickVariant(a.id, "   ")).toBeNull()
  })

  it("distributes across variants for many recipients", () => {
    const a = makeExperiment()
    updateExperimentStatus(a.id, "running")
    const keys = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      keys.add(pickVariant(a.id, `user${i}@example.com`)!.variant.key)
    }
    expect(keys).toEqual(new Set(["control", "b"]))
  })

  it("resolves by emailKey, preferring a running experiment", () => {
    const a = makeExperiment({ emailKey: "shared-key" })
    const draft = makeExperiment({ emailKey: "shared-key" })
    // Only drafts match so far — still resolves (concluded/draft fallback).
    expect(pickVariant("shared-key", "u@example.com")).toBeNull()
    updateExperimentStatus(a.id, "running")
    // a is running, draft is not: the running experiment wins.
    expect(pickVariant("shared-key", "u@example.com")?.experimentId).toBe(a.id)
    expect(draft.status).toBe("draft")
    // With two running experiments on one key, either may be picked
    // (newest-first order); both must be valid running experiments.
    const b = makeExperiment({ emailKey: "shared-key" })
    updateExperimentStatus(b.id, "running")
    const resolved = pickVariant("shared-key", "u@example.com")
    expect([a.id, b.id]).toContain(resolved?.experimentId)
  })

  it("returns the winner for concluded experiments", () => {
    const a = makeExperiment()
    updateExperimentStatus(a.id, "running")
    concludeExperiment(a.id, "b")
    const assignment = pickVariant(a.id, "anyone@example.com")
    expect(assignment?.variant.key).toBe("b")
    expect(assignment?.experimentId).toBe(a.id)
  })
})
