import { describe, expect, it } from "vitest"

import { changelogReleases, getReleasePath, getReleaseUrl, siteUrl } from "@/lib/changelog"

import { GET } from "./route"

async function feedXml() {
  const response = GET()
  return { response, xml: await response.text() }
}

describe("GET /changelog/feed.xml", () => {
  it("returns an RSS feed with the right content type", async () => {
    const { response } = await feedXml()

    expect(response.headers.get("Content-Type")).toBe("application/rss+xml; charset=utf-8")
    expect(response.status).toBe(200)
  })

  it("renders a well-formed rss/channel skeleton", async () => {
    const { xml } = await feedXml()

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain("<title>Spindle changelog</title>")
    expect(xml).toContain(`<link>${siteUrl}/changelog</link>`)
    expect(xml).toContain('rel="self"')
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true)
  })

  it("emits one item per release with escaped title, guid and pubDate", async () => {
    const { xml } = await feedXml()

    const itemCount = xml.match(/<item>/g)?.length ?? 0
    expect(itemCount).toBe(changelogReleases.length)

    for (const release of changelogReleases) {
      const url = getReleaseUrl(release)
      expect(xml).toContain(`<guid isPermaLink="true">${url}</guid>`)
      expect(xml).toContain(`<link>${url}</link>`)
      expect(xml).toContain(
        `<pubDate>${new Date(`${release.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      )
      for (const tag of release.tags) {
        expect(xml).toContain(`<category>${tag}</category>`)
      }
    }
  })

  it("sets lastBuildDate to the newest release date", async () => {
    const { xml } = await feedXml()
    const latest = changelogReleases
      .map((r) => r.date)
      .sort()
      .at(-1)!

    expect(xml).toContain(
      `<lastBuildDate>${new Date(`${latest}T00:00:00Z`).toUTCString()}</lastBuildDate>`,
    )
  })

  it("keeps item links on the release permalink paths", () => {
    for (const release of changelogReleases) {
      expect(getReleasePath(release)).toMatch(/^\/changelog\/[a-z0-9-]+$/)
    }
  })
})
