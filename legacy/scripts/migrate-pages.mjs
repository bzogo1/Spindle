/* One-time migration: converts the original static HTML pages into Next.js
   App Router page components. Run with: node scripts/migrate-pages.mjs
   Kept in the repo as documentation of how the pages were ported. */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => readFileSync(path.join(root, file), "utf8")

/* -------------------------------------------------------------------------- */
/*  HTML → JSX                                                                */
/* -------------------------------------------------------------------------- */

const NUMERIC_ATTRS = new Set([
  "tabIndex",
  "maxLength",
  "minLength",
  "colSpan",
  "rowSpan",
  "pathLength",
  "aria-valuemin",
  "aria-valuemax",
  "aria-valuenow",
])

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])

const ATTR_MAP = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  autocomplete: "autoComplete",
  enterkeyhint: "enterKeyHint",
  maxlength: "maxLength",
  minlength: "minLength",
  readonly: "readOnly",
  spellcheck: "spellCheck",
  srcset: "srcSet",
  crossorigin: "crossOrigin",
  referrerpolicy: "referrerPolicy",
  allowfullscreen: "allowFullScreen",
  frameborder: "frameBorder",
  contenteditable: "contentEditable",
  colspan: "colSpan",
  rowspan: "rowSpan",
  autofocus: "autoFocus",
  playsinline: "playsInline",
  datetime: "dateTime",
  "xlink:href": "xlinkHref",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "clip-rule": "clipRule",
  "clip-path": "clipPath",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "text-anchor": "textAnchor",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "letter-spacing": "letterSpacing",
  "dominant-baseline": "dominantBaseline",
  "shape-rendering": "shapeRendering",
  "vector-effect": "vectorEffect",
  "marker-start": "markerStart",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "color-interpolation-filters": "colorInterpolationFilters",
  "paint-order": "paintOrder",
  "stroke-dashorigin": "strokeDashorigin",
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  times: "×",
  laquo: "«",
  raquo: "»",
  rarr: "→",
  larr: "←",
  uarr: "↑",
  darr: "↓",
}

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, name) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16))
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10))
    return ENTITIES[name] ?? match
  })
}

function escapeText(text) {
  return text
    .replace(/\{/g, '{"{"}')
    .replace(/\}/g, '{"}"}')
    .replace(/</g, '{"<"}')
    .replace(/>/g, '{">"}')
}

function styleToObject(value) {
  const declarations = value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf(":")
      const prop = part.slice(0, index).trim()
      const val = part.slice(index + 1).trim()
      // Escape quotes/backslashes for the JS string literal.
      return `${JSON.stringify(prop)}: ${JSON.stringify(val)}`
    })
  return `{{ ${declarations.join(", ")} } as CSSProperties}`
}

function parseAttrs(source, tag) {
  const attrs = []
  const re = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g
  let match
  while ((match = re.exec(source))) {
    attrs.push({
      name: match[1],
      value: match[2] ?? match[3] ?? match[4] ?? null,
    })
  }
  return attrs.map(({ name, value }) => ({ name, value, tag }))
}

function convertTag(source) {
  const closingMatch = source.match(/^<\s*\/\s*([a-zA-Z][\w:-]*)\s*>$/)
  if (closingMatch) return { jsx: `</${closingMatch[1]}>`, closing: closingMatch[1].toLowerCase() }

  const nameMatch = source.match(/^<\s*([a-zA-Z][\w:-]*)/)
  if (!nameMatch) return null
  const tag = nameMatch[1]
  const lower = tag.toLowerCase()
  const isSelfClosing = /\/\s*>$/.test(source)

  const body = source.slice(nameMatch[0].length, source.length - (isSelfClosing ? 2 : 1))
  const attrs = parseAttrs(body, lower)

  let usedStyle = false
  const parts = attrs
    .map(({ name, value }) => {
      if (value === null) {
        if (lower === "input" && name === "checked") return "defaultChecked"
        return name === "class" ? "className" : ATTR_MAP[name] ?? name
      }
      if (name === "style") {
        usedStyle = true
        return `style=${styleToObject(decodeEntities(value))}`
      }
      let outName = ATTR_MAP[name] ?? name
      let outValue = value
      if (lower === "input" && name === "value") outName = "defaultValue"
      if (lower === "input" && name === "checked") outName = "defaultChecked"
      if (NUMERIC_ATTRS.has(outName) && /^-?\d+(\.\d+)?$/.test(outValue)) {
        return `${outName}={${outValue}}`
      }
      // Keep HTML entities in JSX attribute strings safe.
      outValue = outValue.replace(/"/g, "&quot;")
      return `${outName}="${outValue}"`
    })
    .join(" ")

  const attrText = parts ? " " + parts : ""
  const close = VOID.has(lower) || isSelfClosing ? " />" : ">"
  return { jsx: `<${tag}${attrText}${close}`, usedStyle, closing: null }
}

function htmlToJsx(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "")
  let result = ""
  let lastIndex = 0
  let preDepth = 0
  const tagRe = /<[^>]*>/g
  let match

  const emitText = (text) => {
    if (!text) return
    const decoded = decodeEntities(text)
    // Inside <pre>, whitespace is significant. Emit the whole text node as a
    // string expression so React keeps the exact newlines and indentation.
    if (preDepth > 0) {
      result += `{${JSON.stringify(decoded)}}`
      return
    }
    // Collapse runs of ASCII whitespace the way a browser would, but keep the
    // source line structure for whitespace-only runs (JSX drops those).
    const normalized = decoded.replace(/[ \t\r\n\f]+/g, " ")
    if (!normalized.trim()) {
      result += decoded
      return
    }
    result += escapeText(normalized)
  }

  while ((match = tagRe.exec(withoutComments))) {
    emitText(withoutComments.slice(lastIndex, match.index))
    const converted = convertTag(match[0])
    if (converted) {
      if (converted.closing === "pre" && preDepth > 0) preDepth -= 1
      result += converted.jsx
      if (!converted.closing && /^<pre\b/i.test(converted.jsx)) preDepth += 1
    }
    lastIndex = tagRe.lastIndex
  }
  emitText(withoutComments.slice(lastIndex))

  return result
}

/* -------------------------------------------------------------------------- */
/*  Link + asset rewriting                                                    */
/* -------------------------------------------------------------------------- */

function rewriteHref(href) {
  const route = (name) => (name === "index" ? "/" : `/${name}`)
  const renamed = (name) => ({ changelog: "changelog" })[name] ?? name
  const htmlLink = href.match(/^(?:\.\/)?([a-z0-9-]+)\.html(#[^"']*)?$/)
  if (htmlLink) return route(renamed(htmlLink[1])) + (htmlLink[2] ?? "")
  if (/^(?:assets|Home - Simple_files)\//.test(href)) return "/" + href
  return href
}

function rewriteLinks(html) {
  return html.replace(/(href|src)="([^"]*)"/g, (match, attr, value) => `${attr}="${rewriteHref(value)}"`)
}

/** React prefers defaultValue on <select> over selected on <option>. */
function normalizeSelects(html) {
  return html.replace(/<select\b([^>]*)>([\s\S]*?)<\/select>/g, (match, attrs, inner) => {
    const selected = inner.match(/<option value="([^"]*)" selected>/)
    const cleaned = inner.replace(/ selected(?=[\s>])/g, "")
    const defaultValue = selected && !/defaultvalue/i.test(attrs) ? ` defaultValue="${selected[1]}"` : ""
    return `<select${attrs}${defaultValue}>${cleaned}</select>`
  })
}

/* -------------------------------------------------------------------------- */
/*  Island placeholders                                                       */
/* -------------------------------------------------------------------------- */

const ISLAND_TAGS = [
  // Home
  [/<div id="ui-hero-badge"><\/div>/g, "<HeroBadge />"],
  [/<div id="ui-hero-actions"><\/div>/g, "<HeroActions />"],
  [/<div id="ui-hero-status"><\/div>/g, "<HeroStatus />"],
  [/<div class="feature-grid" id="ui-feature-grid"><\/div>/g, '<div className="feature-grid"><FeatureCards /></div>'],
  [/<div id="ui-local-note"><\/div>/g, "<LocalSearchNote />"],
  [/<span id="ui-fm-new"><\/span>/g, "<span><FileActions /></span>"],
  [/<div class="fm-storage-track" id="ui-storage-progress"><\/div>/g, '<div className="fm-storage-track"><StorageProgress /></div>'],
  [/<div id="ui-anon-switch"><\/div>/g, "<AnonymousSwitch />"],
  [/<div id="ui-home-globe" class="globe-mount" aria-hidden="true"><\/div>/g, '<div className="globe-mount" aria-hidden="true"><Globe /></div>'],
  [/<span class="globe-avatar" id="ui-globe-avatar"><\/span>/g, '<span className="globe-avatar"><PresenceAvatar /></span>'],
  [/<div class="plan-cards" id="ui-plan-cards"><\/div>/g, '<div className="plan-cards"><PlanCards /></div>'],
  // Lab
  [/<div id="ui-lab-hero-field" class="lab-dither-host" aria-hidden="true"><\/div>/g, '<div className="lab-dither-host" aria-hidden="true"><LabHeroField /></div>'],
  [/<div id="ui-lab-cta-field" class="lab-dither-host lab-dither-host--cta" aria-hidden="true"><\/div>/g, '<div className="lab-dither-host lab-dither-host--cta" aria-hidden="true"><LabCtaField /></div>'],
  // Collaboration
  [/<div id="ui-collab-globe" class="collab-globe-mount" aria-hidden="true"><\/div>/g, '<div className="collab-globe-mount" aria-hidden="true"><Globe /></div>'],
  [/<div id="ui-collab-bottom-globe" class="collab-globe-cta-mount" aria-hidden="true"><\/div>/g, '<div className="collab-globe-cta-mount" aria-hidden="true"><Globe /></div>'],
]

/* -------------------------------------------------------------------------- */
/*  Pages                                                                     */
/* -------------------------------------------------------------------------- */

const PAGES = [
  { file: "index.html", out: "src/app/(site)/page.tsx", component: "HomePage", wrapper: null, islands: "home" },
  { file: "changelog.html", out: "src/app/(changelog)/changelog/page.tsx", component: "ChangelogPage", body: true },
  { file: "platform.html", out: "src/app/(site)/platform/page.tsx", component: "PlatformPage", wrapper: null, css: "pages.css" },
  { file: "solutions.html", out: "src/app/(site)/solutions/page.tsx", component: "SolutionsPage", wrapper: null, css: "pages.css" },
  { file: "pricing.html", out: "src/app/(site)/pricing/page.tsx", component: "PricingPage", wrapper: null, css: "pages.css" },
  { file: "docs.html", out: "src/app/(site)/docs/page.tsx", component: "DocsPage", wrapper: null, css: "pages.css" },
  { file: "about.html", out: "src/app/(site)/about/page.tsx", component: "AboutPage", wrapper: null, css: "pages.css" },
  { file: "automations.html", out: "src/app/(site)/automations/page.tsx", component: "AutomationsPage", wrapper: "automations-page", css: "automations.css", runtime: "automations" },
  { file: "agent.html", out: "src/app/(site)/agent/page.tsx", component: "AgentPage", wrapper: "agent-page", css: "agent.css" },
  { file: "lab.html", out: "src/app/(site)/lab/page.tsx", component: "LabPage", wrapper: "lab-page", css: "lab.css", islands: "lab", runtime: "lab" },
  { file: "infrastructure.html", out: "src/app/(site)/infrastructure/page.tsx", component: "InfrastructurePage", wrapper: "infra-page", css: "infrastructure.css", runtime: "infrastructure" },
  { file: "collaboration.html", out: "src/app/(site)/collaboration/page.tsx", component: "CollaborationPage", wrapper: "collab-page", css: "collaboration.css", islands: "collaboration", runtime: "collaboration" },
]

const IMPORTS = {
  home: [
    'import { Globe } from "@/components/ui/globe"',
    'import {\n  AnonymousSwitch,\n  FeatureCards,\n  FileActions,\n  HeroActions,\n  HeroBadge,\n  HeroStatus,\n  LocalSearchNote,\n  PlanCards,\n  PresenceAvatar,\n  StorageProgress,\n} from "@/components/home-islands"',
  ].join("\n"),
  lab: 'import { LabCtaField, LabHeroField } from "@/components/lab-islands"',
  collaboration: 'import { Globe } from "@/components/ui/globe"',
}

function pageTitle(html) {
  return html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "Spindle"
}

function pageDescription(html) {
  return html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ""
}

function buildPage(page) {
  const html = read(page.file)
  let content

  if (page.body) {
    // Pages that are their own full-bleed shell (the changelog) keep their body.
    content = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "")
    if (!content) throw new Error(`No <body> found in ${page.file}`)
  } else {
    content = html.match(/<main\b[^>]*>[\s\S]*<\/main>/)?.[0]
    if (!content) throw new Error(`No <main> found in ${page.file}`)
  }
  for (const [pattern, replacement] of ISLAND_TAGS) content = content.replace(pattern, replacement)
  content = normalizeSelects(rewriteLinks(content))

  const jsx = htmlToJsx(content)
  const title = pageTitle(html)
  const description = pageDescription(html)
  const cssImport = page.css ? `\nimport "../../styles/${page.css}"` : ""
  const islandImport = page.islands && IMPORTS[page.islands] ? `\n${IMPORTS[page.islands]}` : ""
  const runtimeImport = page.runtime ? '\nimport { PageInteractions } from "@/components/site/page-interactions"' : ""
  const usesStyle = / style=/.test(jsx)
  const styleImport = usesStyle ? '\nimport type { CSSProperties } from "react"' : ""

  const body = jsx
  const indented = body
    .split("\n")
    .map((line) => (line.trim() ? "    " + line : ""))
    .join("\n").replace(/\n{2,}/g, "\n")

  const metadataFields = [`  title: ${JSON.stringify(title)}`]
  if (description) metadataFields.push(`  description: ${JSON.stringify(description)}`)

  const runtime = page.runtime ? `\n        <PageInteractions page="${page.runtime}" />` : ""

  const tree = page.wrapper
    ? `    <div className="${page.wrapper}">\n${indented}\n${runtime}\n    </div>`
    : `${indented}${runtime}`

  return `import type { Metadata } from "next"${styleImport}${cssImport}${islandImport}${runtimeImport}

export const metadata: Metadata = {
${metadataFields.join(",\n")},
}

export default function ${page.component}() {
  return (
${tree}
  )
}
`
}

for (const page of PAGES) {
  const outFile = path.join(root, page.out)
  mkdirSync(path.dirname(outFile), { recursive: true })
  writeFileSync(outFile, buildPage(page))
  console.log("wrote", page.out)
}

/* -------------------------------------------------------------------------- */
/*  Shared footer + icon sprite                                               */
/* -------------------------------------------------------------------------- */

const home = read("index.html")

const sprite = home.match(/<svg class="svg-sprite"[\s\S]*?<\/svg>/)?.[0]
if (!sprite) throw new Error("Icon sprite not found")
const spriteJsx = htmlToJsx(sprite)
writeFileSync(
  path.join(root, "src/components/site/icon-sprite.tsx"),
  `/* Icon sprite shared by every page, ported from the original index.html. */
export function IconSprite() {
  return (
    ${spriteJsx}
  )
}
`,
)
console.log("wrote src/components/site/icon-sprite.tsx")

const footer = home.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)?.[0]
if (!footer) throw new Error("Footer not found")
const footerHtml = rewriteLinks(footer).replace('href="#top"', 'href="/"').replace(
  /<div class="socials" id="ui-socials"><\/div>/,
  '<div className="socials"><SocialLinks /></div>',
)
const footerJsx = htmlToJsx(footerHtml)
writeFileSync(
  path.join(root, "src/components/site/site-footer.tsx"),
  `import { SocialLinks } from "@/components/site/social-links"

export function SiteFooter() {
  return (
    ${footerJsx
      .split("\n")
      .map((line) => (line.trim() ? "    " + line : ""))
      .join("\n").replace(/\n{2,}/g, "\n")}
  )
}
`,
)
console.log("wrote src/components/site/site-footer.tsx")
