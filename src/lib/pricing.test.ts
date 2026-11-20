import { describe, expect, it } from "vitest"

import {
  billingPeriods,
  comparisonRows,
  plans,
  pricingFaqs,
  pricingStats,
  yearlyDiscountNote,
} from "./pricing"

describe("pricing config", () => {
  it("has one price per plan per billing period", () => {
    const periodIds = billingPeriods.map((period) => period.id)

    for (const plan of plans) {
      for (const period of periodIds) {
        expect(plan.price[period]).toBeDefined()
        expect(plan.price[period].unit.length).toBeGreaterThan(0)
      }
    }
  })

  it("aligns every plan's comparison cells with the row labels", () => {
    for (const plan of plans) {
      expect(plan.comparison).toHaveLength(comparisonRows.length)
    }
  })

  it("gives every plan a CTA that links somewhere", () => {
    for (const plan of plans) {
      const { cta } = plan
      expect(cta.href).toMatch(/^\//)
      expect(cta.label.length).toBeGreaterThan(0)
    }
  })

  it("keeps FAQ questions unique and non-empty", () => {
    const questions = pricingFaqs.map((faq) => faq.question)

    expect(questions.length).toBeGreaterThan(0)
    expect(new Set(questions).size).toBe(questions.length)
    for (const faq of pricingFaqs) {
      expect(faq.answer.length).toBeGreaterThan(0)
    }
  })

  it("has a free plan and contact-us pricing for paid plans", () => {
    const free = plans.find((plan) => plan.price.monthly.amount === 0)
    const custom = plans.filter((plan) => plan.price.monthly.amount === null)

    expect(free).toBeDefined()
    // Team and Enterprise both use contact-us pricing — no placeholder amounts.
    expect(custom.map((plan) => plan.id).sort()).toEqual(["enterprise", "team"])
    for (const plan of custom) {
      expect(plan.price.yearly.amount).toBeNull()
      expect(plan.cta.href).toBe("/contact")
    }
    expect(yearlyDiscountNote.length).toBeGreaterThan(0)
    expect(pricingStats.length).toBeGreaterThan(0)
  })
})
