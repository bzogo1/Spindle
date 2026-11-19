import type { Metadata } from "next"

import {
  changelogReleases,
  formatReleaseDate,
  getReleaseAnchor,
  type ChangelogBlock,
} from "@/lib/changelog"

import { ChangelogThemeToggle } from "@/components/site/changelog-theme-toggle"
import { CookieSettingsButton } from "@/components/site/cookie-settings-button"

export const metadata: Metadata = {
  title: "Changelog",
  description: "What shipped and what changed in Spindle.",
}

function ReleaseBody({ blocks }: { blocks: ChangelogBlock[] }) {
  return blocks.map((block, index) =>
    block.type === "paragraph" ? (
      <p key={index}>{block.text}</p>
    ) : (
      <ul key={index}>
        {block.items.map((item) => (
          <li key={item.label}>
            <strong>{item.label}</strong> {item.text}
          </li>
        ))}
      </ul>
    ),
  )
}

export default function ChangelogPage() {
  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div className="cl-shell cl-topbar-inner">
          <h1 className="cl-page-title">Changelog</h1>
          <ChangelogThemeToggle />
        </div>
      </div>
      <div className="cl-shell cl-content">
        {changelogReleases.length === 0 ? (
          <p className="cl-empty">
            No releases yet. New entries will appear here and in the{" "}
            <a href="/changelog/feed.xml">RSS feed</a>.
          </p>
        ) : (
          changelogReleases.map((release) => (
            <article className="cl-release" id={getReleaseAnchor(release)} key={release.slug}>
              <div className="cl-release-grid">
                <div className="cl-meta">
                  <div className="cl-meta-inner">
                    <time className="cl-date" dateTime={release.date}>
                      {formatReleaseDate(release.date)}
                    </time>
                    <div className="cl-version">{release.version}</div>
                  </div>
                </div>
                <div className="cl-entry">
                  <div className="cl-rail" aria-hidden="true">
                    <span className="cl-rail-dot"></span>
                  </div>
                  <div className="cl-stack">
                    <header className="cl-head">
                      <h2 className="cl-release-title">{release.title}</h2>
                      <div className="cl-tags">
                        {release.tags.map((tag) => (
                          <span className="cl-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </header>
                    <div className="cl-prose">
                      {release.media ? (
                        <figure className="cl-figure">
                          {release.media.kind === "video" ? (
                            <video
                              className="cl-media"
                              controls
                              loop
                              preload="none"
                              width={release.media.width}
                              height={release.media.height}
                              poster={release.media.poster}
                            >
                              <source src={release.media.src} />
                            </video>
                          ) : (
                            <img
                              className="cl-media"
                              src={release.media.src}
                              alt={release.media.alt}
                              width={release.media.width}
                              height={release.media.height}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </figure>
                      ) : null}
                      <ReleaseBody blocks={release.body} />
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
        <p className="cl-back">
          <a href="/">← Back to Spindle</a> · <a href="/changelog/feed.xml">RSS feed</a> ·{" "}
          <CookieSettingsButton />
        </p>
      </div>
    </div>
  )
}
