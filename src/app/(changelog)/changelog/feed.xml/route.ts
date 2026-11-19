import { changelogReleases, getReleaseUrl, siteUrl, type ChangelogRelease } from "@/lib/changelog"

// The feed is generated from the same static data as the changelog page.
export const dynamic = "force-static"

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function renderItem(release: ChangelogRelease) {
  const url = getReleaseUrl(release)
  const categories = release.tags
    .map((tag) => `      <category>${escapeXml(tag)}</category>`)
    .join("\n")

  return [
    "    <item>",
    `      <title>${escapeXml(release.title)}</title>`,
    `      <link>${escapeXml(url)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
    `      <pubDate>${new Date(`${release.date}T00:00:00Z`).toUTCString()}</pubDate>`,
    `      <description>${escapeXml(release.summary)}</description>`,
    categories,
    "    </item>",
  ]
    .filter(Boolean)
    .join("\n")
}

export function GET() {
  const latest = changelogReleases
    .map((release) => release.date)
    .sort()
    .at(-1)
  const lastBuildDate = latest
    ? `    <lastBuildDate>${new Date(`${latest}T00:00:00Z`).toUTCString()}</lastBuildDate>`
    : ""

  const items = changelogReleases.map(renderItem).join("\n")

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Spindle changelog</title>",
    `    <link>${siteUrl}/changelog</link>`,
    "    <description>What shipped and what changed in Spindle.</description>",
    "    <language>en</language>",
    `    <atom:link href="${siteUrl}/changelog/feed.xml" rel="self" type="application/rss+xml" />`,
    lastBuildDate,
    items,
    "  </channel>",
    "</rss>",
    "",
  ]
    .filter(Boolean)
    .join("\n")

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  })
}
