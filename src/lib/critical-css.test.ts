/**
 * Drift guard for the inlined critical CSS in `critical-css.ts`.
 *
 * `SITE_CRITICAL_CSS` / `AUTH_CRITICAL_CSS` intentionally duplicate a subset
 * of the deferred stylesheets (`styles.css`, `pages.css`, `auth.css`) plus the
 * `--ui-*` tokens from `index.css`. Because the copies are hand-maintained,
 * they can silently diverge from the source — this test fails when a token or
 * a spot-checked rule in the critical CSS no longer matches its source.
 *
 * The checks are subset checks: every declaration the critical CSS carries
 * must exist with the same value in the source. Intentional omissions (rules
 * or declarations the critical CSS leaves out to stay small) are fine.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { AUTH_CRITICAL_CSS, SITE_CRITICAL_CSS } from "./critical-css"

function loadStylesheet(name: string): string {
  return readFileSync(join(process.cwd(), "src/app/styles", name), "utf8")
}

const STYLES_CSS = loadStylesheet("styles.css")
const PAGES_CSS = loadStylesheet("pages.css")
const AUTH_CSS = loadStylesheet("auth.css")
const INDEX_CSS = loadStylesheet("index.css")

/** Collapse comments and whitespace so selector/declaration text compares cleanly. */
function normalize(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Return the `{ ... }` body of the first rule whose selector list equals
 * `selector` (whitespace-insensitive). Throws via expect when absent.
 */
function extractBlock(css: string, selector: string): string {
  const haystack = normalize(css)
  const needle = `${normalize(selector)} {`
  const start = haystack.indexOf(needle)
  expect(start, `expected a "${selector}" rule in the stylesheet`).toBeGreaterThanOrEqual(0)
  const open = start + needle.length - 1 // index of "{"
  let depth = 0
  for (let i = open; i < haystack.length; i++) {
    const ch = haystack[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return haystack.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced braces after "${selector}"`)
}

/** Parse a declaration block into prop -> value (values already whitespace-normalized). */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of body.split(";")) {
    const colon = part.indexOf(":")
    if (colon === -1) continue
    const prop = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (prop) map.set(prop, value)
  }
  return map
}

/**
 * Assert every declaration in `critical` exists with the same value in
 * `source`. Missing properties fail with the property name for debugging.
 */
function expectDeclarationsMatch(
  critical: Map<string, string>,
  source: Map<string, string>,
  label: string,
): void {
  for (const [prop, value] of critical) {
    expect(source.has(prop), `${label}: "${prop}" is not declared by the source stylesheet`).toBe(
      true,
    )
    expect(source.get(prop), `${label}: "${prop}" drifted`).toBe(value)
  }
}

/**
 * Design-token source of truth. The critical CSS inlines tokens from both
 * `styles.css` (palette/geometry/type) and `index.css` (`--ui-*` tokens used
 * by buttons and the skip link); the two sets are disjoint, so merging is safe.
 */
function sourceTokens(selector: ":root" | ":root:not(.dark)"): Map<string, string> {
  const merged = declarations(extractBlock(INDEX_CSS, selector))
  for (const [prop, value] of declarations(extractBlock(STYLES_CSS, selector))) {
    merged.set(prop, value)
  }
  return merged
}

/**
 * Concatenated deferred stylesheets used for rule spot-checks. `pages.css`
 * owns the `.page-*` chrome that SITE_CRITICAL_CSS also inlines; `auth.css`
 * owns the `.auth-*` shell.
 */
const DEFERRED_CSS = [STYLES_CSS, PAGES_CSS, AUTH_CSS].join("\n")

/** Representative above-the-fold rules duplicated into SITE_CRITICAL_CSS. */
const SITE_RULES = [
  "body",
  "a",
  "button, input",
  "img, svg",
  "::selection",
  ":focus-visible",
  ".sr-only",
  ".skip-link",
  ".skip-link:focus-visible",
  ".container",
  ".btn",
  ".btn--lg",
  ".btn--primary",
  ".btn--primary:hover",
  ".btn--ghost",
  ".site-header",
  ".site-header.scrolled",
  ":root:not(.dark) .site-header",
  ":root:not(.dark) .btn--ghost:hover",
  ".header-inner",
  ".brand",
  ".brand-mark",
  ".brand-name",
  ".nav-desktop-slot",
  ".nav-fallback",
  ".nav-fallback a",
  ".header-actions",
  ".sign-in",
  ".nav-mobile",
  ".hero",
  ".hero-inner",
  ".hero-announce",
  ".hero-title",
  ".hero-subtitle",
  ".hero-actions",
  ".hero-secondary",
  ".hero-visual",
  ".eyebrow",
  ".page-main",
  ".page-hero",
  ".page-hero > .container",
  ".page-title",
  ".page-lede",
] as const

/**
 * Representative rules duplicated into AUTH_CRITICAL_CSS. Deliberately
 * excludes `.menu-toggle`: the critical CSS intentionally overrides
 * `display`/`cursor`, so it is not a verbatim copy.
 */
const AUTH_RULES = [
  ".auth-body",
  ".auth-glow",
  ".auth-main",
  ".auth-shell",
  ".auth-brand",
  ".auth-brand:hover",
  ".auth-brand-mark",
  ".auth-brand-mark svg",
  ".auth-brand-name",
  ".auth-card",
  ".auth-eyebrow",
  ".auth-title",
  ".auth-desc",
  ".auth-form",
  ".auth-submit",
  ".auth-secondary-btn",
  ".auth-secondary-btn:hover",
  ".auth-links",
  ".auth-link-button",
  ".auth-link-button:hover",
  ".auth-card-foot",
  ".auth-card-foot a",
  ".auth-card-foot a:hover",
  ".auth-legal",
  ".auth-legal a",
  ".auth-legal a:hover",
  ".auth-password",
  ".auth-password input",
  ".auth-password-toggle",
  ".auth-password-toggle:hover",
  ".auth-password-toggle svg",
  ".auth-hint",
  ".auth-error",
  ".auth-state",
  ".auth-state-icon",
  ".auth-state-icon svg",
  ".auth-state-title",
  ".auth-state-text",
  ".auth-state-text strong",
  ".auth-actions",
  ".auth-badge",
  ".auth-badge svg",
  ".auth-badge--warn",
  ".auth-spinner",
  ".auth-spinner--lg",
  ":root:not(.dark) .auth-error",
  ":root:not(.dark) .auth-secondary-btn:hover, :root:not(.dark) .auth-password-toggle:hover",
] as const

describe("critical CSS drift guard", () => {
  describe.each([":root", ":root:not(.dark)"] as const)("design tokens in %s", (selector) => {
    const source = sourceTokens(selector)

    it("SITE_CRITICAL_CSS matches styles.css/index.css", () => {
      expectDeclarationsMatch(
        declarations(extractBlock(SITE_CRITICAL_CSS, selector)),
        source,
        `SITE_CRITICAL_CSS ${selector}`,
      )
    })

    it("AUTH_CRITICAL_CSS matches styles.css/index.css", () => {
      // Auth pages share the site palette; auth.css defines no :root tokens.
      expectDeclarationsMatch(
        declarations(extractBlock(AUTH_CRITICAL_CSS, selector)),
        source,
        `AUTH_CRITICAL_CSS ${selector}`,
      )
    })
  })

  it.each(SITE_RULES)("SITE_CRITICAL_CSS rule %s matches the source", (selector) => {
    expectDeclarationsMatch(
      declarations(extractBlock(SITE_CRITICAL_CSS, selector)),
      declarations(extractBlock(DEFERRED_CSS, selector)),
      `SITE_CRITICAL_CSS ${selector}`,
    )
  })

  it.each(AUTH_RULES)("AUTH_CRITICAL_CSS rule %s matches auth.css", (selector) => {
    expectDeclarationsMatch(
      declarations(extractBlock(AUTH_CRITICAL_CSS, selector)),
      declarations(extractBlock(AUTH_CSS, selector)),
      `AUTH_CRITICAL_CSS ${selector}`,
    )
  })
})
