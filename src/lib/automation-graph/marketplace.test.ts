import { describe, expect, it } from "vitest"

import { isGraphValid } from "./graph"
import { AUTOMATION_TEMPLATES } from "./templates"
import {
  categoryLabel,
  formatInstalls,
  getMarketplaceTemplate,
  marketplaceTemplates,
  searchMarketplace,
  TEMPLATE_CATEGORIES,
} from "./marketplace"

describe("marketplace", () => {
  it("enriches every template with metadata", () => {
    const templates = marketplaceTemplates()
    expect(templates).toHaveLength(AUTOMATION_TEMPLATES.length)
    for (const template of templates) {
      expect(template.rating).toBeGreaterThanOrEqual(1)
      expect(template.rating).toBeLessThanOrEqual(5)
      expect(template.installs).toBeGreaterThanOrEqual(0)
      expect(TEMPLATE_CATEGORIES.some((c) => c.id === template.category)).toBe(true)
    }
  })

  it("every marketplace template builds a valid graph", () => {
    for (const template of marketplaceTemplates()) {
      const graph = template.build()
      expect(isGraphValid(graph), template.id).toBe(true)
      expect(graph.nodes.length).toBeGreaterThan(0)
    }
  })

  it("filters by category", () => {
    const alerting = searchMarketplace("", "alerting")
    expect(alerting.length).toBeGreaterThan(0)
    expect(alerting.every((t) => t.category === "alerting")).toBe(true)
  })

  it("searches by name, description, and tags", () => {
    expect(searchMarketplace("digest").some((t) => t.id === "daily-digest")).toBe(true)
    expect(searchMarketplace("pipeline").some((t) => t.id === "error-alert")).toBe(true)
    expect(searchMarketplace("zzz-no-match")).toHaveLength(0)
  })

  it("sorts by rating then installs", () => {
    const results = searchMarketplace("", "all")
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]
      const curr = results[i]
      expect(
        prev.rating > curr.rating ||
          (prev.rating === curr.rating && prev.installs >= curr.installs),
      ).toBe(true)
    }
  })

  it("formats install counts", () => {
    expect(formatInstalls(512)).toBe("512")
    expect(formatInstalls(1903)).toBe("1.9k")
    expect(formatInstalls(12000)).toBe("12k")
  })

  it("resolves categories and lookups", () => {
    expect(categoryLabel("triage")).toBe("Triage & routing")
    expect(getMarketplaceTemplate("daily-digest")?.name).toBe("Daily digest")
    expect(getMarketplaceTemplate("nope")).toBeUndefined()
  })
})
