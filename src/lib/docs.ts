/**
 * Docs metadata shared by the index page, the per-guide routes, and search.
 *
 * The content itself lives in `content/docs/*.mdx`. `scripts/build-docs-content.mjs`
 * reads the frontmatter at build time and writes the manifest imported here, so
 * adding a guide only requires a new MDX file.
 */

import manifest from "@/generated/docs-manifest.json"

export type DocIcon = "folder" | "bolt" | "sparkle"

export type DocHeading = { id: string; title: string }

export type DocGuide = {
  /** Filename without `.mdx`; also the route slug. */
  id: string
  eyebrow: string
  title: string
  description: string
  /** Sidebar group, ordered by the lowest `order` in the section. */
  section: string
  /** Reading order, and order inside the sidebar section. */
  order: number
  updated: string
  draft: boolean
  headings: DocHeading[]
}

const DOC_GUIDES = (manifest as { guides: DocGuide[] }).guides

/** Reading order across the whole docs set, drafts excluded. */
export function getPublishedGuides(): DocGuide[] {
  const sectionOrder = new Map<string, number>()

  for (const guide of DOC_GUIDES) {
    const current = sectionOrder.get(guide.section)
    if (current === undefined || guide.order < current) {
      sectionOrder.set(guide.section, guide.order)
    }
  }

  return DOC_GUIDES.filter((guide) => !guide.draft)
    .slice()
    .sort((a, b) => {
      const sectionDelta =
        (sectionOrder.get(a.section) ?? Number.MAX_SAFE_INTEGER) -
        (sectionOrder.get(b.section) ?? Number.MAX_SAFE_INTEGER)
      return sectionDelta !== 0 ? sectionDelta : a.order - b.order
    })
}

/** Table-of-contents entries for a guide, from its `##` headings. */
export function getGuideHeadings(guide: DocGuide): DocHeading[] {
  return guide.headings
}

export type DocsNavSection = {
  title: string
  guides: { id: string; title: string }[]
}

export function getDocsNavigation(): DocsNavSection[] {
  const sections: DocsNavSection[] = []

  for (const guide of getPublishedGuides()) {
    let section = sections.find((entry) => entry.title === guide.section)
    if (!section) {
      section = { title: guide.section, guides: [] }
      sections.push(section)
    }
    section.guides.push({ id: guide.id, title: guide.title })
  }

  return sections
}

export function getGuide(id: string): DocGuide | undefined {
  return getPublishedGuides().find((guide) => guide.id === id)
}

export type DocsPager = {
  previous: DocGuide | null
  next: DocGuide | null
  /** 1-based position in reading order. */
  position: number
  total: number
}

export function getDocsPager(id: string): DocsPager | null {
  const guides = getPublishedGuides()
  const index = guides.findIndex((guide) => guide.id === id)
  if (index === -1) return null

  return {
    previous: index > 0 ? guides[index - 1] : null,
    next: index < guides.length - 1 ? guides[index + 1] : null,
    position: index + 1,
    total: guides.length,
  }
}

/**
 * Old `/docs#anchor` links mapped to the guide route that now owns the content.
 * Both guide ids and heading ids (including the prefixed ids the old single-page
 * docs used) are included.
 */
export function getDocsAnchorMap(): Record<string, string> {
  const anchors: Record<string, string> = {}

  for (const guide of getPublishedGuides()) {
    const guideHref = `/docs/${guide.id}`
    anchors[guide.id] = guideHref

    for (const heading of guide.headings) {
      const href = `${guideHref}#${heading.id}`
      anchors[heading.id] = anchors[heading.id] ?? href

      const baseId = heading.id.startsWith(`${guide.id}-`)
        ? heading.id.slice(guide.id.length + 1)
        : heading.id
      anchors[baseId] = anchors[baseId] ?? href
    }
  }

  return anchors
}
