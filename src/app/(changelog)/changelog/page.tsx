import type { Metadata } from "next"

import { changelogReleases } from "@/lib/changelog"
import { createPageMetadata } from "@/lib/seo"

import { ChangelogReleaseArticle } from "@/components/site/changelog-release"
import { ChangelogThemeToggle } from "@/components/site/changelog-theme-toggle"
import { CookieSettingsButton } from "@/components/site/cookie-settings-button"

const description = "What shipped and what changed in Spindle."

export const metadata: Metadata = createPageMetadata({
  title: "Changelog",
  description,
  path: "/changelog",
})

export default function ChangelogPage() {
  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div className="cl-shell cl-topbar-inner">
          <h1 className="cl-page-title">Changelog</h1>
          <ChangelogThemeToggle />
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
          <a href="/#newsletter">Subscribe to product updates</a> ·{" "}
          <a href="/">← Back to Spindle</a> · <a href="/changelog/feed.xml">RSS feed</a> ·{" "}
          <CookieSettingsButton />
        </p>
      </main>
    </div>
  )
}
