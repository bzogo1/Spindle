import type { Metadata } from "next"
import Link from "next/link"

import { changelogReleases } from "@/lib/changelog"
import { createPageMetadata } from "@/lib/seo"

import { ChangelogReleaseArticle } from "@/components/site/changelog-release"
import { CookieSettingsButton } from "@/components/site/cookie-settings-button"

const description = "What shipped and what changed in Spindle."

export const metadata: Metadata = createPageMetadata({
  title: "Spindle / Changelog",
  description,
  path: "/changelog",
})

export default function ChangelogPage() {
  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div className="cl-shell cl-topbar-inner">
          <h1 className="cl-page-title">Spindle / Changelog</h1>
        </div>
      </div>
      <main id="main-content" tabIndex={-1} className="cl-shell cl-content">
        {changelogReleases.length === 0 ? (
          <p className="cl-empty">
            No releases yet. New entries will appear here and in the{" "}
            <a href="/changelog/feed.xml">RSS feed</a>.
          </p>
        ) : (
          changelogReleases.map((release) => (
            <ChangelogReleaseArticle key={release.slug} release={release} />
          ))
        )}
        <p className="cl-back">
          <Link href="/#newsletter">Subscribe to product updates</Link> ·{" "}
          <Link href="/">← Back to Spindle</Link> · <a href="/changelog/feed.xml">RSS feed</a> ·{" "}
          <CookieSettingsButton />
        </p>
      </main>
    </div>
  )
}
