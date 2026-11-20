import "../../../styles/pages.css"

import { PageTransition } from "@/components/view-transitions/view-transitions"
import { createPageMetadata } from "@/lib/seo"

import { VIDEO_DOCS } from "./video-data"
import { VideoEmbed } from "./video-embed"

export const metadata = createPageMetadata({
  title: "Video guides — Spindle",
  description:
    "Video documentation framework: lazy-loaded, privacy-friendly embeds with transcript and caption slots.",
  path: "/tutorials/videos",
})

export default function VideoDocsPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Video documentation</div>
            <h1 className="page-title">Guides, on demand.</h1>
            <p className="page-lede">
              Videos load only after a click — no third-party requests fire on page load. Each entry
              carries duration metadata and a transcript/captions slot for accessibility.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Guides</div>
              <h2 className="section-title">Watch and follow along.</h2>
              <p className="section-desc">
                These entries use the placeholder constant <code>EXAMPLE_VIDEO_ID</code> from{" "}
                <code>video-data.ts</code>. Replace it — or set <code>videoId</code> /{" "}
                <code>src</code> per item — with a real video before publishing.
              </p>
            </div>
            <div className="video-docs-list">
              {VIDEO_DOCS.map((video) => (
                <VideoEmbed key={video.id} video={video} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
