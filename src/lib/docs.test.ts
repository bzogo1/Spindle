import { describe, expect, it } from "vitest"

import {
  getDocsAnchorMap,
  getDocsNavigation,
  getDocsPager,
  getGuide,
  getGuideHeadings,
  getPublishedGuides,
} from "./docs"

const GUIDE_IDS = [
  "quickstart",
  "workspaces",
  "lab",
  "search",
  "agent",
  "collaboration",
  "automations",
  "developers",
  "guides",
  "faq",
]

describe("docs content helpers", () => {
  it("derives the table of contents from the MDX headings, in order", () => {
    const workspaces = getGuide("workspaces")!
    expect(getGuideHeadings(workspaces).map((heading) => heading.title)).toEqual([
      "One tree per project",
      "Project layout",
      "Files and previews",
    ])
  })

  it("groups navigation by section and reading order", () => {
    const navigation = getDocsNavigation()

    expect(navigation.map((section) => section.title)).toEqual([
      "Getting started",
      "Using Spindle",
      "Platform",
      "More",
    ])
    expect(navigation[0].guides.map((guide) => guide.id)).toEqual(["quickstart", "workspaces"])
    expect(getPublishedGuides().map((guide) => guide.id)).toEqual(GUIDE_IDS)
  })

  it("computes previous and next in reading order", () => {
    expect(getDocsPager("quickstart")).toMatchObject({
      previous: null,
      next: { id: "workspaces" },
      position: 1,
      total: GUIDE_IDS.length,
    })

    expect(getDocsPager("faq")).toMatchObject({
      previous: { id: "guides" },
      next: null,
      position: GUIDE_IDS.length,
    })

    expect(getDocsPager("missing")).toBeNull()
    expect(getGuide("missing")).toBeUndefined()
  })

  it("keeps heading ids unique across the docs set", () => {
    const headingIds = getPublishedGuides().flatMap((guide) =>
      getGuideHeadings(guide).map((heading) => heading.id),
    )

    expect(new Set(headingIds).size).toBe(headingIds.length)
  })

  it("maps old /docs#anchor links to per-guide routes", () => {
    const anchors = getDocsAnchorMap()

    expect(anchors.quickstart).toBe("/docs/quickstart")
    expect(anchors.guides).toBe("/docs/guides")
    expect(anchors["search-two-search-modes"]).toBe("/docs/search#search-two-search-modes")
  })
})
