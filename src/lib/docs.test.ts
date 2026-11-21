import { describe, expect, it } from "vitest"

import {
  getDocsAnchorMap,
  getDocsNavigation,
  getDocsPager,
  getGuide,
  getGuideHeadings,
  getGuideQuickLinks,
  getPublishedGuides,
} from "./docs"

const GUIDE_IDS = [
  "quickstart",
  "workspaces",
  "lab",
  "search",
  "agent",
  "automations",
  "collaboration",
  "developers",
  "guides",
  "faq",
]

const DIRECTORY_TITLES = [
  "Getting started",
  "Core concepts",
  "Projects",
  "Files & data",
  "Lab & compute",
  "Search & sources",
  "Agent",
  "Automations",
  "Collaboration",
  "Developers & API",
  "Integrations",
  "Security & privacy",
  "Deployment & infrastructure",
  "Account & billing",
  "Administration",
  "Tutorials",
  "Troubleshooting",
  "FAQ",
  "Reference",
  "Release notes",
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

    expect(navigation.map((section) => section.title)).toEqual(DIRECTORY_TITLES)
    expect(navigation[0].guides.map((guide) => guide.id)).toEqual(["quickstart", "workspaces"])
    // Directories without guides yet still appear, with an empty guide list.
    expect(navigation.find((section) => section.title === "Core concepts")?.guides).toEqual([])
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

  it("prefers curated related guides, then fills from reading order", () => {
    // developers.mdx declares related: [guides, faq] in frontmatter.
    expect(getGuideQuickLinks("developers").map((guide) => guide.id)).toEqual([
      "guides",
      "faq",
    ])

    // quickstart declares two related guides, so no neighbors are added.
    expect(getGuideQuickLinks("quickstart").map((guide) => guide.id)).toEqual([
      "workspaces",
      "lab",
    ])

    // agent.mdx declares related: [automations, lab].
    expect(getGuideQuickLinks("agent").map((guide) => guide.id)).toEqual([
      "automations",
      "lab",
    ])

    // collaboration.mdx declares a single related id; the next guide in
    // reading order fills the second slot.
    expect(getGuideQuickLinks("collaboration").map((guide) => guide.id)).toEqual([
      "workspaces",
      "developers",
    ])

    expect(getGuideQuickLinks("missing")).toEqual([])
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
