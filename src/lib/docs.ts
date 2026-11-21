/**
 * Docs metadata shared by the index page, the per-guide routes, and search.
 *
 * The content itself lives in `content/docs/*.mdx`. `scripts/build-docs-content.mjs`
 * reads the frontmatter at build time and writes the manifest imported here, so
 * adding a guide only requires a new MDX file.
 */

import manifest from "@/generated/docs-manifest.json"

import {
  DOCS_DIRECTORIES,
  docsDirectoryIndex,
  resolveDocsDirectory,
  type DocsDirectoryNode,
} from "./docs-directories"

export { DOCS_DIRECTORIES }
export type { DocsDirectory, DocsDirectoryNode } from "./docs-directories"

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
  /** Guide ids curated in frontmatter; rendered as quick links at the foot of the page. */
  related?: string[]
  headings: DocHeading[]
}

const DOC_GUIDES = (manifest as { guides: DocGuide[] }).guides

function directoryRank(section: string): number {
  return docsDirectoryIndex(section)
}

function compareGuides(a: DocGuide, b: DocGuide): number {
  const directoryDelta = directoryRank(a.section) - directoryRank(b.section)
  return directoryDelta !== 0 ? directoryDelta : a.order - b.order
}

/** Reading order across the whole docs set, drafts excluded. */
export function getPublishedGuides(): DocGuide[] {
  return DOC_GUIDES.filter((guide) => !guide.draft).slice().sort(compareGuides)
}

/** Table-of-contents entries for a guide, from its `##` headings. */
export function getGuideHeadings(guide: DocGuide): DocHeading[] {
  return guide.headings
}

export type DocsNavSection = {
  title: string
  guides: { id: string; title: string }[]
  children?: DocsNavSection[]
}

export function getDocsNavigation(): DocsNavSection[] {
  const guidesByNode = new Map<DocsDirectoryNode, { id: string; title: string }[]>()
  const unknown = new Map<string, { id: string; title: string }[]>()

  for (const guide of getPublishedGuides()) {
    const entry = { id: guide.id, title: guide.title }
    const directory = resolveDocsDirectory(guide.section)

    if (directory) {
      const guides = guidesByNode.get(directory.node) ?? []
      guides.push(entry)
      guidesByNode.set(directory.node, guides)
    } else {
      const guides = unknown.get(guide.section) ?? []
      guides.push(entry)
      unknown.set(guide.section, guides)
    }
  }

  const build = (nodes: DocsDirectoryNode[]): DocsNavSection[] =>
    nodes.map((node) => ({
      title: node.title,
      guides: guidesByNode.get(node) ?? [],
      children: build(node.children),
    }))

  const sections = build(DOCS_DIRECTORIES)

  // Guides whose frontmatter section has no directory yet still appear, after
  // the known directories, so nothing silently drops out of the nav.
  for (const [title, guides] of unknown) {
    sections.push({ title, guides, children: [] })
  }

  return sections
}

export function getGuide(id: string): DocGuide | undefined {
  return getPublishedGuides().find((guide) => guide.id === id)
}

/**
 * Up to two quick links for the foot of a guide page: the guide's curated
 * `related` ids first, then neighbors in reading order fill any remaining
 * slots so every page still offers a way onward.
 */
export function getGuideQuickLinks(id: string): DocGuide[] {
  const guides = getPublishedGuides()
  const index = guides.findIndex((guide) => guide.id === id)
  if (index === -1) return []

  const seen = new Set([id])
  const links: DocGuide[] = []
  const push = (target: DocGuide | undefined) => {
    if (target && !seen.has(target.id) && links.length < 2) {
      seen.add(target.id)
      links.push(target)
    }
  }

  for (const relatedId of guides[index].related ?? []) {
    push(guides.find((guide) => guide.id === relatedId))
  }
  for (let step = 1; links.length < 2 && step < guides.length; step += 1) {
    push(guides[(index + step) % guides.length])
  }

  return links
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
