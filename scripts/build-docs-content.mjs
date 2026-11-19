/**
 * Builds the docs manifest from `content/docs/*.mdx`.
 *
 * The manifest is the single source of navigation, per-guide metadata, headings
 * for the table of contents, and the static search index. It also fails the
 * build when an internal docs link points at a route, guide, or heading that
 * does not exist.
 */

import fs from "node:fs"
import path from "node:path"

import GithubSlugger from "github-slugger"
import matter from "gray-matter"

const root = process.cwd()
const docsDir = path.join(root, "content", "docs")
const outFile = path.join(root, "src", "generated", "docs-manifest.json")

const errors = []

if (!fs.existsSync(docsDir)) {
  console.error(`Docs content directory is missing: ${docsDir}`)
  process.exit(1)
}

function fail(message) {
  errors.push(message)
}

function plainInline(input) {
  return input
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return null
}

/** Headings and plain text for the search index, split at each `##` heading. */
function extractContent(content, guide) {
  const slugger = new GithubSlugger()
  const headings = []
  const sections = []
  const blockTags = new Set(["DocCode", "GuideCard"])

  let current = {
    sectionId: guide.id,
    sectionTitle: guide.title,
    parts: [guide.description],
  }
  let inFence = false
  let fenceLines = []
  let skipTag = null

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (inFence) {
      if (trimmed.startsWith("```")) {
        inFence = false
        if (fenceLines.length > 0) current.parts.push(fenceLines.join(" "))
      } else {
        fenceLines.push(trimmed)
      }
      continue
    }

    if (trimmed.startsWith("```")) {
      inFence = true
      fenceLines = []
      continue
    }

    if (skipTag) {
      if (trimmed.endsWith("/>") || trimmed.startsWith(`</${skipTag}`)) {
        skipTag = null
      }
      continue
    }

    if (trimmed.startsWith("<")) {
      const tagName = /^<([A-Za-z][\w-]*)/.exec(trimmed)?.[1]
      if (tagName && blockTags.has(tagName) && !trimmed.includes("/>")) {
        skipTag = tagName
      }
      continue
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed)
    if (heading) {
      const text = plainInline(heading[2])
      // Keep the prefixed ids the old single-page docs used, so existing deep
      // links such as /docs/search#search-two-search-modes still resolve.
      const id = `${guide.id}-${slugger.slug(text)}`
      if (heading[1].length === 2) {
        sections.push(current)
        current = { sectionId: id, sectionTitle: text, parts: [] }
        headings.push({ id, title: text })
      }
      continue
    }

    const text = plainInline(trimmed)
    if (text) current.parts.push(text)
  }

  sections.push(current)

  return {
    headings,
    search: sections
      .filter((section) => section.parts.some((part) => part.trim()))
      .map((section) => ({
        sectionId: section.sectionId,
        sectionTitle: section.sectionTitle,
        text: section.parts.join(" "),
      })),
  }
}

function collectLinks(content) {
  const links = new Set()

  for (const match of content.matchAll(/\]\((\/[^)\s]+)\)/g)) links.add(match[1])
  for (const match of content.matchAll(/\bhref=["'](\/[^"']+)["']/g)) {
    links.add(match[1])
  }

  return [...links]
}

/** Route patterns from `src/app`, with route groups removed. */
function collectRoutePatterns() {
  const patterns = []
  const appDir = path.join(root, "src", "app")

  function walk(dir, segments) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name.startsWith("(") && entry.name.endsWith(")")) {
          walk(fullPath, segments)
        } else if (entry.name.startsWith("[") && entry.name.endsWith("]")) {
          walk(fullPath, [
            ...segments,
            {
              dynamic: !entry.name.startsWith("[..."),
              catchAll: entry.name.startsWith("[..."),
            },
          ])
        } else {
          walk(fullPath, [...segments, { value: entry.name }])
        }
        continue
      }

      if (/^page\.(?:[jt]sx?)$/.test(entry.name)) patterns.push(segments)
    }
  }

  walk(appDir, [])
  return patterns
}

function matchesRoute(segments, pathname) {
  if (segments.some((segment) => segment.catchAll)) return false

  const parts = pathname.split("/").filter(Boolean)
  let index = 0

  for (const segment of segments) {
    if (index >= parts.length) return false
    if (segment.value && segment.value !== parts[index]) return false
    index += 1
  }

  return index === parts.length
}

/** Any `id="anchor"` in the app source, used to validate fragment links. */
function collectSourceAnchors() {
  const anchors = new Set()
  const srcDir = path.join(root, "src")

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!/\.(?:tsx?|jsx?|css|mdx)$/.test(entry.name)) continue

      const source = fs.readFileSync(fullPath, "utf8")
      for (const match of source.matchAll(/\bid=["']([^"']+)["']/g)) {
        anchors.add(match[1])
      }
    }
  }

  walk(srcDir)
  return anchors
}

const files = fs
  .readdirSync(docsDir)
  .filter((file) => file.endsWith(".mdx"))
  .sort()

if (files.length === 0) {
  console.error(`No MDX guides found in ${docsDir}`)
  process.exit(1)
}

const guides = []

for (const file of files) {
  const source = fs.readFileSync(path.join(docsDir, file), "utf8")
  const id = file.replace(/\.mdx$/, "")
  const { data, content } = matter(source)

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    fail(`${file}: filename must be a lowercase slug.`)
    continue
  }

  for (const field of ["title", "description", "section"]) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      fail(`${file}: frontmatter "${field}" is required.`)
    }
  }

  if (!Number.isInteger(data.order) || data.order < 1) {
    fail(`${file}: frontmatter "order" must be a positive integer.`)
  }

  const updated = normalizeDate(data.updated)
  if (!updated) {
    fail(`${file}: frontmatter "updated" must be a YYYY-MM-DD date.`)
  }

  if (data.eyebrow !== undefined && typeof data.eyebrow !== "string") {
    fail(`${file}: frontmatter "eyebrow" must be a string when present.`)
  }

  if (data.draft !== undefined && typeof data.draft !== "boolean") {
    fail(`${file}: frontmatter "draft" must be a boolean when present.`)
  }

  const title = typeof data.title === "string" ? data.title.trim() : ""
  const description = typeof data.description === "string" ? data.description.trim() : ""

  const guide = {
    id,
    title,
    description,
    eyebrow:
      typeof data.eyebrow === "string" && data.eyebrow.trim()
        ? data.eyebrow.trim()
        : typeof data.section === "string"
          ? data.section.trim()
          : "",
    section: typeof data.section === "string" ? data.section.trim() : "",
    order: Number.isInteger(data.order) ? data.order : 0,
    updated: updated ?? "",
    draft: data.draft === true,
    ...extractContent(content, { id, title, description }),
  }

  guides.push({ guide, content, file })
}

const ids = new Set()
const orders = new Set()

for (const { guide, file } of guides) {
  if (ids.has(guide.id)) fail(`${file}: duplicate guide id "${guide.id}".`)
  ids.add(guide.id)

  const orderKey = `${guide.section}:${guide.order}`
  if (orders.has(orderKey)) {
    fail(`${file}: duplicate order ${guide.order} in section "${guide.section}".`)
  }
  orders.add(orderKey)
}

const routePatterns = collectRoutePatterns()
const sourceAnchors = collectSourceAnchors()

function isKnownRoute(pathname) {
  if (pathname === "/") return true
  if (routePatterns.some((segments) => matchesRoute(segments, pathname))) {
    return true
  }
  return fs.existsSync(path.join(root, "public", pathname.replace(/^\//, "")))
}

for (const { content, file } of guides) {
  for (const link of collectLinks(content)) {
    const decoded = (() => {
      try {
        return decodeURIComponent(link)
      } catch {
        return link
      }
    })()

    const hashIndex = decoded.indexOf("#")
    const pathPart = hashIndex === -1 ? decoded : decoded.slice(0, hashIndex)
    const hash = hashIndex === -1 ? "" : decoded.slice(hashIndex + 1)
    const pathname = pathPart || "/"

    if (pathname === "/docs") {
      const knownHash =
        ids.has(hash) ||
        guides.some((entry) =>
          entry.guide.headings.some(
            (heading) => heading.id === hash || heading.id === `${entry.guide.id}-${hash}`,
          ),
        )
      if (hash && !knownHash) {
        fail(`${file}: /docs#${hash} does not match a guide or heading.`)
      }
      continue
    }

    if (pathname.startsWith("/docs/")) {
      const slug = pathname.slice("/docs/".length)
      const target = guides.find((entry) => entry.guide.id === slug)
      if (!target) {
        fail(`${file}: "${link}" points at a guide that does not exist.`)
        continue
      }

      if (
        hash &&
        !target.guide.headings.some(
          (heading) => heading.id === hash || heading.id === `${slug}-${hash}`,
        )
      ) {
        fail(`${file}: "${link}" points at a heading that does not exist.`)
      }
      continue
    }

    if (!isKnownRoute(pathname)) {
      fail(`${file}: "${link}" points at an unknown internal route.`)
      continue
    }

    if (hash && !sourceAnchors.has(hash)) {
      fail(`${file}: "${link}" points at an unknown page anchor.`)
    }
  }
}

if (errors.length > 0) {
  console.error("Docs content check failed:\n")
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

const sectionOrder = new Map()
for (const { guide } of guides) {
  const current = sectionOrder.get(guide.section)
  if (current === undefined || guide.order < current) {
    sectionOrder.set(guide.section, guide.order)
  }
}

guides.sort((a, b) => {
  const sectionDelta =
    (sectionOrder.get(a.guide.section) ?? Number.MAX_SAFE_INTEGER) -
    (sectionOrder.get(b.guide.section) ?? Number.MAX_SAFE_INTEGER)
  return sectionDelta !== 0 ? sectionDelta : a.guide.order - b.guide.order
})

const manifest = {
  guides: guides.map(({ guide }) => guide),
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Docs manifest: ${manifest.guides.length} guides -> ${path.relative(root, outFile)}`)
