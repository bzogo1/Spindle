import { notFound } from "next/navigation"
import "../../../styles/pages.css"

import { createDocHeading } from "@/components/docs/doc-blocks"
import { DocsShell } from "@/components/docs/docs-shell"
import { getGuide, getPublishedGuides } from "@/lib/docs"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const dynamicParams = false

export function generateStaticParams() {
  return getPublishedGuides().map((guide) => ({ slug: guide.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = getGuide(slug)
  if (!guide) return {}

  return createPageMetadata({
    title: `${guide.title} — Spindle Docs`,
    description: guide.description,
    path: `/docs/${guide.id}`,
    type: "article",
    modifiedTime: `${guide.updated}T00:00:00Z`,
  })
}

export default async function DocsGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = getGuide(slug)
  if (!guide) notFound()

  const { default: GuideBody } = await import(`@content/docs/${slug}.mdx`)

  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <a className="doc-skip-link" href="#doc-article">
          Skip to article content
        </a>

        <section className="page-hero page-hero--docs">
          <div className="container">
            <div className="eyebrow">{guide.eyebrow}</div>
            <h1 className="page-title">{guide.title}</h1>
            <p className="page-lede">{guide.description}</p>
            <a className="doc-hero-search" href="/docs#docs-search">
              <svg className="icon icon--sm" aria-hidden="true">
                <use href="#i-search" />
              </svg>
              Search the docs
              <span>Find a guide or section</span>
            </a>
          </div>
        </section>

        <DocsShell id={slug}>
          <div className="doc-block">
            <GuideBody components={{ h2: createDocHeading(slug) }} />
          </div>
        </DocsShell>
      </main>
    </PageTransition>
  )
}
