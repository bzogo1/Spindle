import { describe, expect, it } from "vitest"

import { assignVariant, pickVariant } from "./assign"
import { enrollmentBucket, hashBucket, subjectHash, variantBucket } from "./bucket"
import type { ExperimentDefinition } from "./types"

const fiftyFifty: ExperimentDefinition = {
  name: "checkout-cta",
  description: "test experiment",
  variants: [
    { name: "control", weight: 50 },
    { name: "treatment", weight: 50 },
  ],
}

const subjects = (n: number) => Array.from({ length: n }, (_, i) => `user-${i}`)

describe("hashBucket", () => {
  it("is deterministic and stays in [0, 9999]", () => {
    expect(hashBucket("a|b|c")).toBe(hashBucket("a|b|c"))
    for (let i = 0; i < 500; i++) {
      const bucket = hashBucket(`input-${i}`)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(10_000)
    }
  })

  it("produces different buckets for different inputs", () => {
    expect(hashBucket("x")).not.toBe(hashBucket("y"))
  })
})

describe("enrollmentBucket / variantBucket", () => {
  it("are namespaced apart — same subject gets different streams", () => {
    const disagreements = subjects(200).filter(
      (s) => enrollmentBucket("exp", s) === variantBucket("exp", s),
    )
    // Both are 0–9999 so ~1% collide by chance; require most to differ.
    expect(disagreements.length).toBeLessThan(50)
  })

  it("salt changes the bucket", () => {
    expect(enrollmentBucket("exp", "u1", "a")).not.toBe(enrollmentBucket("exp", "u1", "b"))
  })
})

describe("subjectHash", () => {
  it("is stable, hex, and scoped per experiment", () => {
    const h1 = subjectHash("exp-a", "user-1")
    expect(h1).toBe(subjectHash("exp-a", "user-1"))
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
    expect(h1).not.toBe(subjectHash("exp-b", "user-1"))
  })
})

describe("pickVariant", () => {
  const variants = [
    { name: "a", weight: 25 },
    { name: "b", weight: 25 },
    { name: "c", weight: 50 },
  ]

  it("walks cumulative weights over the bucket space", () => {
    // bucket 0–2499 → a (25%), 2500–4999 → b, 5000–9999 → c
    expect(pickVariant(variants, 0)?.name).toBe("a")
    expect(pickVariant(variants, 2499)?.name).toBe("a")
    expect(pickVariant(variants, 2500)?.name).toBe("b")
    expect(pickVariant(variants, 4999)?.name).toBe("b")
    expect(pickVariant(variants, 5000)?.name).toBe("c")
    expect(pickVariant(variants, 9999)?.name).toBe("c")
  })

  it("returns null for the weight remainder", () => {
    const partial = [{ name: "treatment", weight: 30 }]
    expect(pickVariant(partial, 2999)?.name).toBe("treatment")
    expect(pickVariant(partial, 3000)).toBeNull()
    expect(pickVariant(partial, 9999)).toBeNull()
  })

  it("treats 0% and 100% boundaries correctly", () => {
    const v = [{ name: "all", weight: 0 }]
    expect(pickVariant(v, 0)).toBeNull()
    const w = [{ name: "all", weight: 100 }]
    expect(pickVariant(w, 9999)?.name).toBe("all")
  })
})

describe("assignVariant", () => {
  it("is deterministic for the same (experiment, subject)", () => {
    const a = assignVariant(fiftyFifty, { subjectId: "user-42" })
    const b = assignVariant(fiftyFifty, { subjectId: "user-42" })
    expect(a).toEqual(b)
  })

  it("splits a 50/50 experiment roughly evenly", () => {
    const counts = { control: 0, treatment: 0 }
    for (const s of subjects(2000)) {
      const { variant } = assignVariant(fiftyFifty, { subjectId: s })
      expect(["control", "treatment"]).toContain(variant)
      counts[variant as keyof typeof counts]++
    }
    // Loose bounds: FNV-1a is uniform enough that ±10% is generous.
    expect(counts.control).toBeGreaterThan(850)
    expect(counts.control).toBeLessThan(1150)
    expect(counts.treatment).toBeGreaterThan(850)
    expect(counts.treatment).toBeLessThan(1150)
  })

  it("enrolls only the configured traffic percentage", () => {
    const def: ExperimentDefinition = {
      ...fiftyFifty,
      traffic: 25,
    }
    let enrolled = 0
    for (const s of subjects(2000)) {
      const a = assignVariant(def, { subjectId: s })
      if (a.enrolled) {
        enrolled++
        expect(a.variant).not.toBeNull()
      } else {
        expect(a.variant).toBeNull()
        expect(a.reason).toBe("not-enrolled")
      }
    }
    expect(enrolled).toBeGreaterThan(400)
    expect(enrolled).toBeLessThan(600)
  })

  it("traffic 0 enrolls nobody; traffic 100 enrolls everybody", () => {
    for (const s of subjects(100)) {
      expect(assignVariant({ ...fiftyFifty, traffic: 0 }, { subjectId: s }).enrolled).toBe(false)
      expect(assignVariant({ ...fiftyFifty, traffic: 100 }, { subjectId: s }).enrolled).toBe(true)
    }
  })

  it("non-running statuses assign nobody", () => {
    for (const status of ["draft", "stopped"] as const) {
      const a = assignVariant({ ...fiftyFifty, status }, { subjectId: "user-1" })
      expect(a.variant).toBeNull()
      expect(a.enrolled).toBe(false)
      expect(a.reason).toBe("not-running")
    }
  })

  it("respects the date window", () => {
    const def: ExperimentDefinition = {
      ...fiftyFifty,
      startDate: "2025-01-01T00:00:00Z",
      endDate: "2025-02-01T00:00:00Z",
    }
    const before = assignVariant(def, {
      subjectId: "user-1",
      now: new Date("2024-12-31T23:59:59Z"),
    })
    expect(before.reason).toBe("outside-window")
    const during = assignVariant(def, {
      subjectId: "user-1",
      now: new Date("2025-01-15T00:00:00Z"),
    })
    expect(during.enrolled).toBe(true)
    const after = assignVariant(def, {
      subjectId: "user-1",
      now: new Date("2025-02-01T00:00:00Z"),
    })
    expect(after.reason).toBe("outside-window")
  })

  it("ignores malformed dates rather than bricking assignment", () => {
    const def: ExperimentDefinition = { ...fiftyFifty, startDate: "not-a-date" }
    const a = assignVariant(def, { subjectId: "user-1" })
    expect(a.enrolled).toBe(true)
  })

  it("salt re-randomises the same population", () => {
    const salted: ExperimentDefinition = { ...fiftyFifty, salt: "v2" }
    const differences = subjects(200).filter((s) => {
      const a = assignVariant(fiftyFifty, { subjectId: s })
      const b = assignVariant(salted, { subjectId: s })
      return a.variant !== b.variant || a.bucket !== b.bucket
    })
    expect(differences.length).toBeGreaterThan(50)
  })

  it("reports unassigned-variant for the weight remainder", () => {
    const def: ExperimentDefinition = {
      name: "partial",
      description: "30% treatment, rest implicit control",
      variants: [{ name: "treatment", weight: 30 }],
    }
    const seen = new Set<string>()
    for (const s of subjects(500)) {
      const a = assignVariant(def, { subjectId: s })
      expect(a.enrolled).toBe(true)
      if (a.variant === null) {
        expect(a.reason).toBe("unassigned-variant")
      } else {
        expect(a.variant).toBe("treatment")
        seen.add(a.reason)
      }
    }
    expect(seen.has("assigned")).toBe(true)
  })

  it("defaults missing subjectId to the empty-string bucket", () => {
    const a = assignVariant(fiftyFifty)
    const b = assignVariant(fiftyFifty, { subjectId: "" })
    expect(a.variant).toBe(b.variant)
    expect(a.subjectId).toBe("")
  })
})
