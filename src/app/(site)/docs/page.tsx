import type { Metadata } from "next"

import "../../styles/pages.css"

import { DocsLegacyAnchorRedirect } from "@/components/docs/docs-legacy-anchor-redirect"
import { DocsSearch } from "@/components/docs/docs-search"
import { getDocsAnchorMap, getDocsNavigation, getPublishedGuides } from "@/lib/docs"

export const metadata: Metadata = {
  title: "Documentation — Spindle",
  description:
    "Set up a Spindle workspace, connect a lab session, run local search, and write automations for your research project.",
}

export default function DocsPage() {
  const navigation = getDocsNavigation()
  const guidesById = new Map(getPublishedGuides().map((guide) => [guide.id, guide]))

  return (
    <main id="top" className="page-main">
      <DocsLegacyAnchorRedirect anchors={getDocsAnchorMap()} />

      <section className="page-hero">
        <div className="container">
          <div className="eyebrow">Documentation</div>
          <h1 className="page-title">Everything you need to get going.</h1>
          <p className="page-lede">
            A short path from an empty workspace to a project with files, a lab, sources, and a
            working automation.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container doc-index">
          <div className="doc-index-search">
            <DocsSearch anchorId="docs-search" />
          </div>

          {navigation.map((section) => (
            <section className="doc-index-section" key={section.title}>
              <h2 className="doc-index-title">{section.title}</h2>
              <div className="doc-index-list">
                {section.guides.map((entry) => {
                  const guide = guidesById.get(entry.id)
                  if (!guide) return null

                  return (
                    <a
                      id={guide.id}
                      key={guide.id}
                      className="doc-index-card"
                      href={`/docs/${guide.id}`}
                    >
                      <span className="doc-index-card-body">
                        <strong>{guide.title}</strong>
                        <span>{guide.description}</span>
                      </span>
                      <svg className="icon icon--sm" aria-hidden="true">
                        <use href="#i-arrow-right" />
                      </svg>
                    </a>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  )
}
