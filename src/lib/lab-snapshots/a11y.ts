/**
 * Dependency-free static accessibility checker for snapshot HTML.
 *
 * axe-core is available for real browser runs (see `e2e/lab-a11y.spec.ts`),
 * but snapshot captures are often just stored markup/fragments — this module
 * runs the cheap, high-signal checks directly on an HTML string:
 *
 *  - `lang` missing on <html>
 *  - <img> without alt text
 *  - form controls without an accessible name (label/aria-*)
 *  - inline-style color pairs below WCAG AA contrast (4.5:1)
 *  - heading-level skips (e.g. h1 → h3)
 *
 * Heuristic only — a passing report does NOT mean the page is accessible.
 */

export type A11ySeverity = "minor" | "moderate" | "serious" | "critical"

export interface A11yFinding {
  /** Stable rule id, e.g. "image-alt". */
  rule: string
  severity: A11ySeverity
  message: string
  /** Snippet of the offending markup (truncated). */
  element?: string
}

export interface A11yReport {
  /** 0–100 score; 100 = no findings. */
  score: number
  pass: boolean
  findings: A11yFinding[]
  /** Counts per rule for quick scanning. */
  byRule: Record<string, number>
  summary: string[]
  evaluatedAt: string
}

interface HtmlTag {
  name: string
  attrs: Record<string, string>
  raw: string
}

const TAG_RE = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const ATTR_RE = /([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g

function parseTags(html: string): HtmlTag[] {
  const tags: HtmlTag[] = []
  for (const match of html.matchAll(TAG_RE)) {
    const raw = match[0]
    if (raw.startsWith("</")) continue // closing tags carry no attrs
    const name = match[1].toLowerCase()
    const attrText = match[2] ?? ""
    const attrs: Record<string, string> = {}
    for (const am of attrText.matchAll(ATTR_RE)) {
      const key = am[1].toLowerCase()
      let value = am[2] ?? ""
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      attrs[key] = value
    }
    tags.push({ name, attrs, raw: raw.slice(0, 120) })
  }
  return tags
}

function truncate(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > n ? `${flat.slice(0, n)}…` : flat
}

// --- WCAG contrast helpers -------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  purple: [128, 0, 128],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  orange: [255, 165, 0],
  yellow: [255, 255, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  lime: [0, 255, 0],
  aqua: [0, 255, 255],
  fuchsia: [255, 0, 255],
  transparent: [255, 255, 255], // treat as white-ish for contrast purposes
}

function parseColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase()
  if (NAMED_COLORS[v]) return NAMED_COLORS[v]
  const hex = hexToRgb(v)
  if (hex) return hex
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Extract `color`/`background(-color)` declarations from an inline style attr. */
function inlineColors(style: string): {
  fg?: [number, number, number]
  bg?: [number, number, number]
} {
  const out: { fg?: [number, number, number]; bg?: [number, number, number] } = {}
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":")
    if (idx === -1) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    const color = parseColor(value)
    if (!color) continue
    if (prop === "color") out.fg = color
    else if (prop === "background" || prop === "background-color") out.bg = color
  }
  return out
}

const SEVERITY_WEIGHT: Record<A11ySeverity, number> = {
  minor: 2,
  moderate: 5,
  serious: 10,
  critical: 20,
}

/**
 * Run static accessibility checks over an HTML string (full document or
 * fragment). Returns a scored report; `pass` requires score ≥ 80 and no
 * critical findings.
 */
export function analyzeHtmlForA11y(html: string): A11yReport {
  const tags = parseTags(html)
  const findings: A11yFinding[] = []

  const hasHtmlTag = tags.some((t) => t.name === "html")
  const htmlTag = tags.find((t) => t.name === "html")
  if (hasHtmlTag && htmlTag && !("lang" in htmlTag.attrs)) {
    findings.push({
      rule: "html-lang",
      severity: "serious",
      message: "<html> element is missing a lang attribute.",
      element: truncate(htmlTag.raw),
    })
  }

  // Labels: collect ids referenced by <label for="..."> and elements wrapped
  // in <label> (approximated: any label containing a control id is hard to
  // detect with regex — we check `for` plus aria attributes).
  const labelFors = new Set(
    tags.filter((t) => t.name === "label" && t.attrs.for).map((t) => t.attrs.for),
  )

  for (const tag of tags) {
    if (tag.name === "img") {
      const alt = tag.attrs.alt
      if (alt === undefined) {
        findings.push({
          rule: "image-alt",
          severity: "serious",
          message: "<img> is missing an alt attribute.",
          element: truncate(tag.raw),
        })
      } else if (alt === "" && !tag.attrs.role && tag.attrs.src) {
        // Empty alt is valid for decorative images; flag only when the image
        // looks content-bearing (has a non-generic src/name hint is overkill —
        // keep it as a minor nudge).
        findings.push({
          rule: "image-alt-empty",
          severity: "minor",
          message: "<img> has empty alt — fine for decorative images, verify intent.",
          element: truncate(tag.raw),
        })
      }
    }

    if (["input", "select", "textarea"].includes(tag.name)) {
      const type = (tag.attrs.type ?? "text").toLowerCase()
      if (type === "hidden") continue
      const hasName =
        "aria-label" in tag.attrs ||
        "aria-labelledby" in tag.attrs ||
        (tag.attrs.id !== undefined && labelFors.has(tag.attrs.id))
      if (!hasName) {
        findings.push({
          rule: "form-label",
          severity: "critical",
          message: `<${tag.name}${type !== "text" ? ` type="${type}"` : ""}> has no associated label, aria-label, or aria-labelledby.`,
          element: truncate(tag.raw),
        })
      }
    }

    if (tag.attrs.style) {
      const { fg, bg } = inlineColors(tag.attrs.style)
      if (fg && bg) {
        const ratio = contrastRatio(fg, bg)
        if (ratio < 3) {
          findings.push({
            rule: "color-contrast",
            severity: "critical",
            message: `Inline colors have contrast ratio ${ratio.toFixed(2)}:1 (< 3:1) — fails WCAG for all text sizes.`,
            element: truncate(tag.raw),
          })
        } else if (ratio < 4.5) {
          findings.push({
            rule: "color-contrast",
            severity: "serious",
            message: `Inline colors have contrast ratio ${ratio.toFixed(2)}:1 (< 4.5:1) — fails WCAG AA for normal text.`,
            element: truncate(tag.raw),
          })
        }
      }
    }
  }

  // Heading order: track h1–h6 sequence, flag skips > 1 level.
  let prevLevel = 0
  for (const tag of tags) {
    const m = /^h([1-6])$/.exec(tag.name)
    if (!m) continue
    const level = Number(m[1])
    if (prevLevel > 0 && level > prevLevel + 1) {
      findings.push({
        rule: "heading-order",
        severity: "moderate",
        message: `Heading level skips from h${prevLevel} to h${level} — screen-reader navigation is disrupted.`,
        element: truncate(tag.raw),
      })
    }
    prevLevel = level
  }

  const byRule: Record<string, number> = {}
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0)
  const score = Math.max(0, 100 - penalty)
  const pass = score >= 80 && !findings.some((f) => f.severity === "critical")

  const summary: string[] = []
  if (findings.length === 0) {
    summary.push("No static accessibility issues detected in the captured markup.")
  } else {
    summary.push(`${findings.length} issue(s) found; score ${score}/100.`)
    for (const [rule, count] of Object.entries(byRule)) {
      summary.push(`- ${rule}: ${count}`)
    }
    summary.push("Heuristic check only — run axe-core (e2e/lab-a11y.spec.ts) for full coverage.")
  }

  return { score, pass, findings, byRule, summary, evaluatedAt: new Date().toISOString() }
}
