import "../../styles/pages.css"

import { DocsLegacyAnchorRedirect } from "@/components/docs/docs-legacy-anchor-redirect"
import { DocsMasthead } from "@/components/docs/docs-masthead"
import { DocsSidebar } from "@/components/docs/docs-sidebar"
import {
  getDocsAnchorMap,
  getDocsNavigation,
  getPublishedGuides,
  type DocGuide,
  type DocsNavSection,
} from "@/lib/docs"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Documentation — Spindle",
  description:
    "Set up a Spindle workspace, connect a lab session, run local search, and write automations for your research project.",
  path: "/docs",
})

function DirectoryGuides({
  guides,
  guidesById,
}: {
  guides: { id: string; title: string }[]
  guidesById: Map<string, DocGuide>
}) {
  return (
    <div className="doc-index-list">
      {guides.map((entry) => {
        const guide = guidesById.get(entry.id)
        return (
          <a key={entry.id} id={entry.id} className="doc-index-card" href={`/docs/${entry.id}`}>
            <span className="doc-index-card-body">
              <strong>{entry.title}</strong>
              {guide ? <span>{guide.description}</span> : null}
            </span>
            <svg className="icon icon--sm" aria-hidden="true">
              <use href="#i-arrow-right" />
            </svg>
          </a>
        )
      })}
    </div>
  )
}

function IndexDirectory({
  section,
  guidesById,
  depth,
}: {
  section: DocsNavSection
  guidesById: Map<string, DocGuide>
  depth: number
}) {
  const children = section.children ?? []
  const empty = section.guides.length === 0 && children.length === 0
  const Heading = depth === 0 ? "h2" : "h3"

  return (
    <section className="doc-index-section">
      <Heading className="doc-index-title">
        {section.title}
        {section.guides.length > 0 ? (
          <span className="doc-index-count">{section.guides.length}</span>
        ) : null}
      </Heading>
      {section.guides.length > 0 ? (
        <DirectoryGuides guides={section.guides} guidesById={guidesById} />
      ) : empty ? (
        <p className="doc-index-empty">No pages yet.</p>
      ) : null}
      {children.length > 0 ? (
        <div className="doc-index-subdirs">
          {children.map((child, index) => (
            <IndexDirectory
              key={`${child.title}:${index}`}
              section={child}
              guidesById={guidesById}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default function DocsPage() {
  const navigation = getDocsNavigation()
  const guidesById = new Map(getPublishedGuides().map((guide) => [guide.id, guide]))

  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <a className="doc-skip-link" href="#doc-article">
          Skip to article content
        </a>
        <DocsLegacyAnchorRedirect anchors={getDocsAnchorMap()} />
        <DocsMasthead />

        <section className="section docs-section">
          <div className="doc-layout doc-layout--guide container">
            <DocsSidebar groups={navigation} />

            <div className="doc-main">
              <article id="doc-article" className="doc-content" tabIndex={-1}>
                <h1 className="sr-only">Documentation</h1>
                <header className="doc-index-head">
                  <h1 className="page-title">Everything you need to get going.</h1>
                  <p className="page-lede">
                    A short path from an empty workspace to a project with files, a lab, sources,
                    and a working automation.
                  </p>
                </header>

                <div className="doc-index">
                  {navigation.map((section, index) => (
                    <IndexDirectory
                      key={`${section.title}:${index}`}
                      section={section}
                      guidesById={guidesById}
                      depth={0}
                    />
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
