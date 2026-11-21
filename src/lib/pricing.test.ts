import { describe, expect, it } from "vitest"

import { fundingAreas, plans, pricingFaqs, pricingStats, supportOptions } from "./pricing"

describe("pricing config", () => {
  it("offers only the free Hobby plan and a custom Enterprise agreement", () => {
    expect(plans.map((plan) => plan.id)).toEqual(["hobby", "enterprise"])
    expect(plans.map((plan) => plan.name)).not.toContain("Team")
  })

  it("keeps Hobby at $0 and Enterprise on contact-us pricing", () => {
    const [hobby, enterprise] = plans

    expect(hobby.price).toEqual({ amount: 0, unit: "free forever" })
    expect(enterprise.price.amount).toBeNull()
    expect(enterprise.cta.href).toBe("/contact")
  })

  it("includes the expanded free feature set, with real-time collaboration", () => {
    const hobby = plans.find((plan) => plan.id === "hobby")

    expect(hobby?.features.length).toBeGreaterThanOrEqual(10)
    expect(hobby?.features.map((feature) => feature.text)).toContain(
      "Real-time collaboration with live cursors, comments, and presence",
    )
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

    expect(questions.length).toBeGreaterThan(8)
    expect(new Set(questions).size).toBe(questions.length)
    for (const faq of pricingFaqs) {
      expect(faq.answer.length).toBeGreaterThan(0)
    }
  })

  it("no longer documents monthly or yearly billing", () => {
    const questions = pricingFaqs.map((faq) => faq.question.toLowerCase())

    expect(questions.some((question) => question.includes("yearly"))).toBe(false)
    expect(questions.some((question) => question.includes("monthly"))).toBe(false)
  })

  it("explains where donations go and how people can support the project", () => {
    expect(fundingAreas.length).toBeGreaterThanOrEqual(4)
    expect(supportOptions.length).toBeGreaterThanOrEqual(4)
    expect(pricingStats.length).toBeGreaterThan(0)
  })
})
