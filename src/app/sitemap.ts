import type { MetadataRoute } from "next"

import { changelogReleases, getReleasePath, siteUrl } from "@/lib/changelog"
import { getPublishedGuides } from "@/lib/docs"
import { listArticles } from "@/lib/help-center"

/**
 * Public marketing, docs, and legal routes. Auth and app routes are excluded —
 * they are either disallowed in robots.txt or behind sign-in.
 */
const staticRoutes: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/platform", priority: 0.9 },
  { path: "/pricing", priority: 0.9 },
  { path: "/solutions", priority: 0.8 },
  { path: "/about", priority: 0.7 },
  { path: "/contact", priority: 0.7 },
  { path: "/referral", priority: 0.6 },
  { path: "/agent", priority: 0.7 },
  { path: "/automations", priority: 0.7 },
  { path: "/collaboration", priority: 0.7 },
  { path: "/lab", priority: 0.7 },
  { path: "/infrastructure", priority: 0.6 },
  { path: "/security", priority: 0.6 },
  { path: "/docs", priority: 0.8 },
  { path: "/developers", priority: 0.7 },
  { path: "/changelog", priority: 0.6 },
  { path: "/help", priority: 0.6 },
  { path: "/terms", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
  { path: "/cookies", priority: 0.3 },
  { path: "/dpa", priority: 0.3 },
  { path: "/acceptable-use", priority: 0.3 },
  { path: "/accessibility", priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = staticRoutes.map(({ path, priority }) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: "monthly",
    priority,
  }))

  for (const guide of getPublishedGuides()) {
    entries.push({
      url: `${siteUrl}/docs/${guide.id}`,
      lastModified: guide.updated,
      changeFrequency: "monthly",
      priority: 0.6,
    })
  }

  for (const article of listArticles()) {
    entries.push({
      url: `${siteUrl}/help/${article.slug}`,
      lastModified: article.updatedAt,
      changeFrequency: "monthly",
      priority: 0.5,
    })
  }

  for (const release of changelogReleases) {
    entries.push({
      url: `${siteUrl}${getReleasePath(release)}`,
      lastModified: release.date,
      changeFrequency: "yearly",
      priority: 0.4,
    })
  }

  return entries
}
