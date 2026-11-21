import { notFound } from "next/navigation"
import "../../../styles/pages.css"

import { createDocHeading } from "@/components/docs/doc-blocks"
import { DocsMasthead } from "@/components/docs/docs-masthead"
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
        <DocsMasthead />

        <DocsShell id={slug}>
          <div className="doc-block">
            <h1 className="sr-only">{guide.title}</h1>
            <GuideBody components={{ h2: createDocHeading(slug) }} />
          </div>
        </DocsShell>
      </main>
    </PageTransition>
  )
}
