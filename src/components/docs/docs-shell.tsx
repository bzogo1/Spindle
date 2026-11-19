import type { ReactNode } from "react"

import { getDocsNavigation, getDocsPager, getGuide, getGuideHeadings } from "@/lib/docs"

import { DocsOnThisPage } from "./docs-on-this-page"
import { DocsSidebar } from "./docs-sidebar"

/**
 * Server-rendered docs chrome: sidebar, breadcrumbs, the article slot, and the
 * previous/next pager. Guide content is passed in so the page owns the body
 * while navigation comes from the generated MDX digest in `src/lib/docs.ts`.
 */
export function DocsShell({ id, children }: { id: string; children: ReactNode }) {
  const guide = getGuide(id)
  const pager = getDocsPager(id)
  if (!guide || !pager) return null

  const groups = getDocsNavigation()

  return (
    <section className="section docs-section">
      <div className="container doc-layout doc-layout--guide">
        <DocsSidebar groups={groups} currentId={id} />

        <div className="doc-main">
          <nav className="doc-breadcrumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                <a href="/docs">Docs</a>
              </li>
              <li className="doc-breadcrumb-sep" aria-hidden="true">
                /
              </li>
              <li>
                <span>{guide.section}</span>
              </li>
              <li className="doc-breadcrumb-sep" aria-hidden="true">
                /
              </li>
              <li>
                <span className="doc-breadcrumb-current">{guide.title}</span>
              </li>
            </ol>
          </nav>

          <article id="doc-article" className="doc-content" tabIndex={-1}>
            {children}
          </article>

          <nav className="doc-pager" aria-label="Guide pagination">
            <span className="doc-pager-position">
              Guide {pager.position} of {pager.total}
            </span>
            <div className="doc-pager-links">
              {pager.previous ? (
                <a
                  className="doc-pager-link doc-pager-link--prev"
                  href={`/docs/${pager.previous.id}`}
                >
                  <span className="doc-pager-direction">
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                    Previous
                  </span>
                  <strong>{pager.previous.title}</strong>
                </a>
              ) : (
                <span className="doc-pager-spacer" aria-hidden="true" />
              )}

              {pager.next ? (
                <a className="doc-pager-link doc-pager-link--next" href={`/docs/${pager.next.id}`}>
                  <span className="doc-pager-direction">
                    Next
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                  <strong>{pager.next.title}</strong>
                </a>
              ) : (
                <span className="doc-pager-spacer" aria-hidden="true" />
              )}
            </div>
          </nav>
        </div>

        <DocsOnThisPage headings={getGuideHeadings(guide)} />
      </div>
    </section>
  )
}
