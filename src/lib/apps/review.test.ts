import { describe, expect, it } from "vitest"

import {
  APP_REVIEW_CATEGORIES,
  getCriterion,
  getReviewCategories,
  isReviewApproved,
  reviewCriterionCount,
  summarizeReview,
  type ReviewCheck,
} from "./review"

const allRequiredPass: ReviewCheck[] = APP_REVIEW_CATEGORIES.flatMap((category) =>
  category.criteria
    .filter((criterion) => criterion.required)
    .map((criterion) => ({ criterionId: criterion.id, status: "pass" as const })),
)

describe("review model data", () => {
  it("has the four expected categories", () => {
    expect(APP_REVIEW_CATEGORIES.map((c) => c.id)).toEqual([
      "security",
      "permissions",
      "ux",
      "performance",
    ])
  })

  it("every category has criteria with unique ids", () => {
    const ids = APP_REVIEW_CATEGORIES.flatMap((c) => c.criteria.map((cr) => cr.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(reviewCriterionCount())
    for (const id of ids) expect(getCriterion(id)).not.toBeNull()
  })

  it("each category has at least one required criterion", () => {
    for (const category of APP_REVIEW_CATEGORIES) {
      expect(category.criteria.some((c) => c.required)).toBe(true)
    }
  })

  it("getReviewCategories returns a mutable copy", () => {
    const copy = getReviewCategories()
    copy[0].criteria.pop()
    expect(APP_REVIEW_CATEGORIES[0].criteria.length).toBeGreaterThan(0)
  })
})

describe("summarizeReview", () => {
  it("approves when all required criteria pass", () => {
    const summary = summarizeReview(allRequiredPass)
    expect(summary.approved).toBe(true)
    expect(summary.requiredPassed).toBe(summary.requiredTotal)
    expect(isReviewApproved(allRequiredPass)).toBe(true)
  })

  it("blocks approval on a single required failure", () => {
    const fresh = allRequiredPass.map((c) =>
      c.criterionId === "sec-https" ? { ...c, status: "fail" as const } : c,
    )
    expect(summarizeReview(fresh).approved).toBe(false)
    expect(summarizeReview(fresh).failed).toBe(1)
  })

  it("ignores unknown criterion ids", () => {
    const checks: ReviewCheck[] = [...allRequiredPass, { criterionId: "bogus", status: "fail" }]
    const summary = summarizeReview(checks)
    expect(summary.failed).toBe(0)
    expect(summary.approved).toBe(true)
  })

  it("dedupes repeated criterion ids", () => {
    const checks: ReviewCheck[] = [
      { criterionId: "sec-https", status: "pass" },
      { criterionId: "sec-https", status: "fail" },
    ]
    const summary = summarizeReview(checks)
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it("a required criterion marked n/a still blocks approval", () => {
    const checks = allRequiredPass.map((c) =>
      c.criterionId === "perm-minimal" ? { ...c, status: "na" as const } : c,
    )
    const summary = summarizeReview(checks)
    expect(summary.approved).toBe(false)
    expect(summary.notApplicable).toBe(1)
  })

  it("optional criteria do not block approval", () => {
    const checks: ReviewCheck[] = [
      ...allRequiredPass,
      { criterionId: "ux-accessibility", status: "fail" },
      { criterionId: "perf-caching", status: "na" },
    ]
    const summary = summarizeReview(checks)
    expect(summary.approved).toBe(true)
    expect(summary.failed).toBe(1)
    expect(summary.notApplicable).toBe(1)
  })

  it("empty checks are not approved and report unchecked criteria", () => {
    const summary = summarizeReview([])
    expect(summary.approved).toBe(false)
    expect(summary.unchecked).toBe(reviewCriterionCount())
    expect(summary.percent).toBe(0)
  })

  it("computes percent over evaluated criteria", () => {
    const checks: ReviewCheck[] = [
      { criterionId: "sec-https", status: "pass" },
      { criterionId: "sec-no-secrets", status: "fail" },
      { criterionId: "ux-accessibility", status: "na" },
    ]
    const summary = summarizeReview(checks)
    expect(summary.percent).toBe(50)
  })
})
