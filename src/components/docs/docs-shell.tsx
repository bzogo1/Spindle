import type { ReactNode } from "react"

import {
  getDocsNavigation,
  getDocsPager,
  getGuide,
  getGuideHeadings,
  getGuideQuickLinks,
} from "@/lib/docs"

import { DocsOnThisPage } from "./docs-on-this-page"
import { DocsSidebar } from "./docs-sidebar"

/**
 * Server-rendered docs chrome: sidebar, breadcrumbs, the article slot, and the
 * quick links at the foot. Guide content is passed in so the page owns the body
 * while navigation comes from the generated MDX digest in `src/lib/docs.ts`.
 */
export function DocsShell({ id, children }: { id: string; children: ReactNode }) {
  const guide = getGuide(id)
  const pager = getDocsPager(id)
  if (!guide || !pager) return null

  const quickLinks = getGuideQuickLinks(id)
  const groups = getDocsNavigation()

  return (
    <section className="section docs-section">
      <div className="doc-layout doc-layout--guide container">
        <DocsSidebar groups={groups} currentId={id} />

        <div className="doc-main">
          <nav className="doc-breadcrumbs" aria-label="Breadcrumb">
            <ol>
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

          {quickLinks.length > 0 ? (
            <nav className="doc-quicklinks" aria-label="Related guides">
              <span className="doc-quicklinks-position">
                Guide {pager.position} of {pager.total}
              </span>
              <div className="doc-quicklinks-list">
                {quickLinks.map((target) => (
                  <a key={target.id} className="doc-quicklink" href={`/docs/${target.id}`}>
                    <span className="doc-quicklink-label">{target.section}</span>
                    <strong>{target.title}</strong>
                  </a>
                ))}
              </div>
            </nav>
          ) : null}
        </div>

        <DocsOnThisPage headings={getGuideHeadings(guide)} />
      </div>
    </section>
  )
}
