import "../../styles/pages.css"

import { HelpSearch } from "@/components/site/help-search"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import { listArticles, listCategories } from "@/lib/help-center"
import { createPageMetadata } from "@/lib/seo"

import styles from "./help.module.css"

const description =
  "Answers to common questions about Spindle — getting started, accounts and security, billing, and the API."

export const metadata = createPageMetadata({
  title: "Help Center — Spindle",
  description,
  path: "/help",
})

export default function HelpPage() {
  const categories = listCategories()
  const articles = listArticles()

  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Help Center</div>
            <h1 className="page-title">How can we help?</h1>
            <p className="page-lede">
              Guides and answers for getting the most out of Spindle — from your first workspace to
              API tokens and webhooks.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className={`contact-grid ${styles.categoryGrid}`}>
              {categories.map((category) => (
                <div className="contact-card" key={category.id}>
                  <h3>{category.title}</h3>
                  <p>{category.description}</p>
                  <span className="card-icon">
                    <svg className="icon icon--sm" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.searchWrap}>
              <HelpSearch initialArticles={articles} categories={categories} />
            </div>

            <p className={styles.contactNote}>
              Still stuck? <a href="/contact">Contact support</a> and we&apos;ll point you to the
              right article — or answer directly.
            </p>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
