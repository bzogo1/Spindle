import "../../../styles/pages.css"

import { DeveloperNav } from "@/components/apps/developer-nav"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Developer changelog — Spindle",
  description:
    "API and developer-portal changes: new endpoints, scope additions, and review criteria updates.",
  path: "/developers/changelog",
})

const ENTRIES = [
  {
    date: "Portal launch",
    title: "Developer portal opens",
    body: "This portal, the permissions model, app analytics, and the review checklist ship together. The API playground covers the current /api surface.",
  },
] as const

export default function ChangelogPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Changelog</div>
            <h1 className="page-title">What changed for developers.</h1>
            <p className="page-lede">
              Endpoint additions, scope changes, and review criteria updates — newest first.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <ol className="doc-steps">
              {ENTRIES.map((entry) => (
                <li key={entry.title} className="doc-step">
                  <strong>{entry.title}.</strong> {entry.body}
                </li>
              ))}
            </ol>
            <p className="section-desc">
              This page is a placeholder — entries will be published alongside API releases.
            </p>
            <div className="page-actions">
              <a href="/developers" className="btn btn--ghost">
                Back to overview
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
