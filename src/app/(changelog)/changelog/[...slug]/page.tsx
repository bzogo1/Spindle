import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { changelogReleases, getRelease, getReleasePath } from "@/lib/changelog"
import { createPageMetadata } from "@/lib/seo"

import { ChangelogReleaseArticle } from "@/components/site/changelog-release"
import { ChangelogThemeToggle } from "@/components/site/changelog-theme-toggle"
import { CookieSettingsButton } from "@/components/site/cookie-settings-button"

export const dynamicParams = false

export function generateStaticParams() {
  return changelogReleases.map((release) => ({ slug: [release.slug] }))
}

function findRelease(slug: string[]) {
  return slug.length === 1 ? getRelease(slug[0]) : undefined
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>
}): Promise<Metadata> {
  const { slug } = await params
  const release = findRelease(slug)
  if (!release) return {}

  const path = getReleasePath(release)

  return createPageMetadata({
    title: `${release.title} — Spindle`,
    description: release.summary,
    path,
    type: "article",
    publishedTime: `${release.date}T00:00:00Z`,
  })
}

/**
 * Dedicated per-release permalink. Unknown slugs — and anything deeper than a
 * single segment — fall through to the changelog 404 inside this layout, so
 * the theme toggle and styles still apply.
 */
export default async function ChangelogReleasePage({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const release = findRelease(slug)
  if (!release) notFound()

  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div className="cl-shell cl-topbar-inner">
          <p className="cl-page-title">
            <a className="cl-topbar-link" href="/changelog">
              Changelog
            </a>
          </p>
          <ChangelogThemeToggle />
        </div>
      </div>
      <main id="main-content" tabIndex={-1} className="cl-shell cl-content">
        <ChangelogReleaseArticle release={release} />
        <p className="cl-back">
          <a href="/changelog">← All releases</a> · <a href="/changelog/feed.xml">RSS feed</a> ·{" "}
          <CookieSettingsButton />
        </p>
      </main>
    </div>
  )
}
