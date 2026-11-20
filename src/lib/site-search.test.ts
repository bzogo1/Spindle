import { describe, expect, it } from "vitest"

import { SITE_PAGES } from "@/lib/site-search"

describe("SITE_PAGES", () => {
  it("uses root-relative, well-formed hrefs", () => {
    for (const page of SITE_PAGES) {
      expect(page.href, page.label).toMatch(/^\/[a-z0-9\-/]*(#[a-z0-9-]+)?$/)
      expect(page.href.startsWith("//"), page.label).toBe(false)
      expect(page.href, page.label).not.toMatch(/[\s]/)
    }
  })

  it("has unique labels and hrefs", () => {
    expect(new Set(SITE_PAGES.map((p) => p.label)).size).toBe(SITE_PAGES.length)
    expect(new Set(SITE_PAGES.map((p) => p.href)).size).toBe(SITE_PAGES.length)
  })

  it("includes the core marketing and legal destinations", () => {
    const hrefs = new Set(SITE_PAGES.map((p) => p.href.split("#")[0]))
    for (const href of [
      "/",
      "/platform",
      "/pricing",
      "/docs",
      "/changelog",
      "/terms",
      "/privacy",
      "/security",
    ]) {
      expect(hrefs.has(href), href).toBe(true)
    }
  })

  it("has non-empty labels and sane lowercase keywords", () => {
    for (const page of SITE_PAGES) {
      expect(page.label.trim().length, page.label).toBeGreaterThan(0)
      const keywords = page.keywords ?? ""
      expect(keywords.trim().length, page.label).toBeGreaterThan(0)
      for (const keyword of keywords.split(/\s+/)) {
        expect(keyword, `${page.label}: ${keyword}`).toMatch(/^[a-z0-9+#.-]+$/)
      }
    }
  })
})
