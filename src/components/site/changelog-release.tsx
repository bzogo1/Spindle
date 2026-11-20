import {
  formatReleaseDate,
  getReleaseAnchor,
  getReleasePath,
  type ChangelogBlock,
  type ChangelogRelease,
} from "@/lib/changelog"

export function ChangelogReleaseBody({ blocks }: { blocks: ChangelogBlock[] }) {
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

/**
 * One release on the timeline. The title links to the dedicated permalink
 * page (`/changelog/<slug>`); the copy button puts that URL on the clipboard.
 * Both the index and the permalink route render this same article.
 */
export function ChangelogReleaseArticle({ release }: { release: ChangelogRelease }) {
  const path = getReleasePath(release)

  return (
    <article className="cl-release" id={getReleaseAnchor(release)} data-permalink={path}>
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
              <h2 className="cl-release-title">
                <a className="cl-release-link" href={path}>
                  {release.title}
                </a>
              </h2>
              <div className="cl-tags">
                {release.tags.map((tag) => (
                  <span className="cl-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <p className="cl-permalink">
                <a className="cl-permalink-link" href={path}>
                  Permalink
                </a>
                <span className="cl-permalink-sep" aria-hidden="true">
                  ·
                </span>
                <button type="button" className="cl-copy-link" data-url={path}>
                  Copy link
                </button>
              </p>
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
              <ChangelogReleaseBody blocks={release.body} />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
