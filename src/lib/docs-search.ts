import manifest from "@/generated/docs-manifest.json"

import { docsDirectoryIndex } from "./docs-directories"

export type DocsGuideSummary = {
  id: string
  title: string
  description: string
}

type ManifestGuide = DocsGuideSummary & {
  draft: boolean
  section: string
  order: number
  search: {
    sectionId: string
    sectionTitle: string
    text: string
  }[]
}

// The manifest is emitted in filename order; present guides in docs reading
// order (directory tree, then frontmatter order) instead.
const guides = (manifest as { guides: ManifestGuide[] }).guides
  .filter((guide) => !guide.draft)
  .sort((a, b) => docsDirectoryIndex(a.section) - docsDirectoryIndex(b.section) || a.order - b.order)

/** The plain list shown before a query is typed. */
export const DOC_GUIDE_SUMMARIES: DocsGuideSummary[] = guides.map(({ id, title, description }) => ({
  id,
  title,
  description,
}))

export type DocsSearchEntry = {
  guideId: string
  guideTitle: string
  sectionId: string
  sectionTitle: string
  href: string
  text: string
}

/**
 * Static index over guide titles, headings, and body text. It is generated
 * from the docs manifest at build time and ships with the client bundle — no
 * fetch and no server endpoint.
 */
export const DOCS_SEARCH_INDEX: DocsSearchEntry[] = guides.flatMap((guide) =>
  guide.search.map((section) => ({
    guideId: guide.id,
    guideTitle: guide.title,
    sectionId: section.sectionId,
    sectionTitle: section.sectionTitle,
    href:
      section.sectionId === guide.id
        ? `/docs/${guide.id}`
        : `/docs/${guide.id}#${section.sectionId}`,
    text: section.text,
  })),
)

export type DocsSearchResult = DocsSearchEntry & {
  snippet: string
  titleMatch: boolean
  score: number
}

const SNIPPET_BEFORE = 48
const SNIPPET_AFTER = 96
const MAX_RESULTS = 8

export function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  )
}

function clipAtWordStart(text: string, index: number): number {
  if (index <= 0) return 0
  const space = text.indexOf(" ", index)
  return space === -1 ? index : Math.min(text.length, space + 1)
}

function clipAtWordEnd(text: string, index: number): number {
  if (index >= text.length) return text.length
  const space = text.lastIndexOf(" ", index)
  return space === -1 ? index : space
}

function makeSnippet(text: string, phrase: string, tokens: string[]): string {
  const lower = text.toLowerCase()
  let at = phrase ? lower.indexOf(phrase) : -1

  if (at < 0) {
    for (const token of tokens) {
      const found = lower.indexOf(token)
      if (found >= 0 && (at < 0 || found < at)) at = found
    }
  }

  if (at < 0) at = 0

  const start = clipAtWordStart(text, Math.max(0, at - SNIPPET_BEFORE))
  const end = clipAtWordEnd(text, Math.min(text.length, at + phrase.length + SNIPPET_AFTER))

  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

/**
 * Case-insensitive search over the static index. Every whitespace-separated
 * token must appear in the section, and title matches rank above body matches.
 * Runs entirely in the browser.
 */
export function searchDocs(
  query: string,
  index: DocsSearchEntry[] = DOCS_SEARCH_INDEX,
): DocsSearchResult[] {
  const phrase = query.trim().toLowerCase()
  if (!phrase) return []

  const tokens = tokenizeQuery(phrase)
  if (tokens.length === 0) return []

  const results: DocsSearchResult[] = []

  for (const entry of index) {
    const sectionTitle = entry.sectionTitle.toLowerCase()
    const guideTitle = entry.guideTitle.toLowerCase()
    const body = entry.text.toLowerCase()
    const haystack = `${sectionTitle} ${guideTitle} ${body}`

    if (!tokens.every((token) => haystack.includes(token))) continue

    let score = 0
    let titleMatch = false
    for (const token of tokens) {
      if (sectionTitle.includes(token)) {
        score += 8
        titleMatch = true
      } else if (guideTitle.includes(token)) {
        score += 4
        titleMatch = true
      }
      if (body.includes(token)) score += 2
    }
    if (haystack.includes(phrase)) score += 6
    // On a tie, send readers to the matching section instead of the guide intro.
    if (entry.sectionId !== entry.guideId) score += 1

    results.push({
      ...entry,
      snippet: makeSnippet(entry.text, phrase, tokens),
      titleMatch,
      score,
    })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
}
