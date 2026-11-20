import Link from "next/link"
import { notFound } from "next/navigation"

import { HelpArticleBody } from "@/components/site/help-article-body"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import { HELP_ARTICLES, getArticleBySlug, listArticles, listCategories } from "@/lib/help-center"
import { createPageMetadata } from "@/lib/seo"

import "../../../styles/pages.css"
import styles from "../help.module.css"

export const dynamicParams = false

export function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticleBySlug(slug)
  if (!article) return {}

  return createPageMetadata({
    title: `${article.title} — Spindle Help`,
    description: article.excerpt,
    path: `/help/${article.slug}`,
    type: "article",
    modifiedTime: `${article.updatedAt}T00:00:00Z`,
  })
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticleBySlug(slug)
  if (!article) notFound()

  // Neighbours in the same updated-desc ordering used across the help center.
  const ordered = listArticles({ category: article.category }).map((entry) => entry.slug)
  const index = ordered.indexOf(article.slug)
  const prevSlug = index > 0 ? ordered[index - 1] : null
  const nextSlug = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null
  const prevArticle = prevSlug ? getArticleBySlug(prevSlug) : undefined
  const nextArticle = nextSlug ? getArticleBySlug(nextSlug) : undefined
  const categoryTitle =
    listCategories().find((category) => category.id === article.category)?.title ?? article.category

  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero page-hero--docs">
          <div className="container">
            <p className={styles.articleMeta}>
              {categoryTitle}
              <span className={styles.articleUpdated}>Updated {article.updatedAt}</span>
            </p>
            <h1 className="page-title">{article.title}</h1>
            <p className="page-lede">{article.excerpt}</p>
          </div>
        </section>

        <section className="section">
          <div className="doc-content container">
            <HelpArticleBody body={article.body} />

            <nav className={styles.articleNav} aria-label="Article navigation">
              {prevArticle ? (
                <Link href={`/help/${prevArticle.slug}`} rel="prev">
                  ← {prevArticle.title}
                </Link>
              ) : (
                <span className={styles.spacer} aria-hidden="true" />
              )}
              <Link href="/help">All articles</Link>
              {nextArticle ? (
                <Link href={`/help/${nextArticle.slug}`} rel="next">
                  {nextArticle.title} →
                </Link>
              ) : (
                <span className={styles.spacer} aria-hidden="true" />
              )}
            </nav>

            <p className={styles.contactNote}>
              Didn&apos;t find what you needed? <Link href="/contact">Contact support</Link> —
              we&apos;ll help directly.
            </p>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
