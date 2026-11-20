import { beforeEach, describe, expect, it } from "vitest"

import {
  listNpsResponses,
  NPS_COMMENT_MAX,
  npsSchema,
  npsSegment,
  recordNpsResponse,
  resetNpsStore,
  summarizeNps,
} from "./nps"

beforeEach(() => {
  resetNpsStore()
})

describe("npsSchema", () => {
  it("accepts a minimal valid response", () => {
    const parsed = npsSchema.safeParse({ score: 9 })
    expect(parsed.success).toBe(true)
  })

  it("accepts score, comment, source, and an empty honeypot", () => {
    const parsed = npsSchema.safeParse({
      score: 10,
      comment: "  Love it  ",
      source: "page",
      website: "",
    })
    expect(parsed.success).toBe(true)
  })

  it.each([-1, 11, 3.5, "7", null])("rejects invalid score %s", (score) => {
    expect(npsSchema.safeParse({ score }).success).toBe(false)
  })

  it("rejects comments over the limit", () => {
    const parsed = npsSchema.safeParse({
      score: 5,
      comment: "x".repeat(NPS_COMMENT_MAX + 1),
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects unknown sources", () => {
    expect(npsSchema.safeParse({ score: 5, source: "carrier-pigeon" }).success).toBe(false)
  })
})

describe("npsSegment", () => {
  it.each([
    [0, "detractor"],
    [6, "detractor"],
    [7, "passive"],
    [8, "passive"],
    [9, "promoter"],
    [10, "promoter"],
  ] as const)("maps %i to %s", (score, segment) => {
    expect(npsSegment(score)).toBe(segment)
  })
})

describe("NPS store", () => {
  it("records responses with ids, trimmed comment, and timestamp", () => {
    const first = recordNpsResponse({ score: 10, comment: "  great  ", source: "widget" })
    const second = recordNpsResponse({ score: 2 })

    expect(first.id).not.toBe(second.id)
    expect(first.comment).toBe("great")
    expect(first.source).toBe("widget")
    expect(first.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Missing source falls back to a placeholder rather than empty string.
    expect(second.source).toBe("unknown")

    expect(listNpsResponses()).toHaveLength(2)
  })

  it("returns copies so callers cannot mutate the store", () => {
    recordNpsResponse({ score: 8 })
    const listed = listNpsResponses()
    listed[0].score = 0
    expect(listNpsResponses()[0].score).toBe(8)
  })

  it("computes the NPS score as %promoters minus %detractors", () => {
    // 2 promoters, 1 passive, 1 detractor → (50% − 25%) = 25
    recordNpsResponse({ score: 10 })
    recordNpsResponse({ score: 9 })
    recordNpsResponse({ score: 7 })
    recordNpsResponse({ score: 3 })

    expect(summarizeNps()).toEqual({
      total: 4,
      promoters: 2,
      passives: 1,
      detractors: 1,
      score: 25,
    })
  })

  it("reports a null score when there are no responses", () => {
    expect(summarizeNps()).toEqual({
      total: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      score: null,
    })
  })
})
