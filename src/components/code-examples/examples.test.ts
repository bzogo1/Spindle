import { describe, expect, it } from "vitest"

import { CODE_EXAMPLES, EXAMPLE_CATEGORIES, groupExamplesByCategory } from "./examples"

describe("code examples data", () => {
  it("has unique ids and non-empty code for every example", () => {
    const ids = CODE_EXAMPLES.map((example) => example.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const example of CODE_EXAMPLES) {
      expect(example.code.trim().length).toBeGreaterThan(0)
      expect(example.title.trim().length).toBeGreaterThan(0)
      expect(example.language.trim().length).toBeGreaterThan(0)
    }
  })

  it("only uses declared categories", () => {
    for (const example of CODE_EXAMPLES) {
      expect(EXAMPLE_CATEGORIES).toContain(example.category)
    }
  })

  it("covers the SDK, REST, and plain-JS surfaces", () => {
    const categories = new Set(CODE_EXAMPLES.map((e) => e.category))
    expect(categories).toEqual(new Set(EXAMPLE_CATEGORIES))
  })

  it("references real generated SDK exports and API paths", () => {
    const sdkExample = CODE_EXAMPLES.find((e) => e.id === "sdk-setup")
    expect(sdkExample?.code).toContain("configureSdk")
    expect(sdkExample?.code).toContain("postContact")
    expect(sdkExample?.code).toContain("@/generated/sdk")

    for (const example of CODE_EXAMPLES) {
      if (example.category === "REST API" || example.category === "JavaScript") {
        expect(example.code).toContain("/api/")
      }
    }
  })
})

describe("groupExamplesByCategory", () => {
  it("groups in declared category order and drops empty groups", () => {
    const groups = groupExamplesByCategory()
    expect(groups.map((g) => g.category)).toEqual([...EXAMPLE_CATEGORIES])
    for (const group of groups) {
      expect(group.examples.length).toBeGreaterThan(0)
      expect(group.examples.every((e) => e.category === group.category)).toBe(true)
    }
  })

  it("filters to a subset when given", () => {
    const subset = CODE_EXAMPLES.filter((e) => e.category === "REST API")
    const groups = groupExamplesByCategory(subset)
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe("REST API")
  })
})
