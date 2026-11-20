import "../../../styles/pages.css"

import { ReviewChecklist } from "@/components/apps/review-checklist"
import { DeveloperNav } from "@/components/apps/developer-nav"
import { APP_REVIEW_CATEGORIES } from "@/lib/apps/review"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "App review — Spindle Developers",
  description:
    "How apps are reviewed before listing: security, permission scope, UX, and performance criteria.",
  path: "/developers/review",
})

export default function ReviewPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Review process</div>
            <h1 className="page-title">Reviewed like it matters.</h1>
            <p className="page-lede">
              Every app submitted to the directory passes the same checklist. Required criteria must
              pass for approval; optional criteria are advisory but tracked.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Criteria</div>
              <h2 className="section-title">What reviewers check.</h2>
            </div>
            <div className="doc-guides">
              {APP_REVIEW_CATEGORIES.map((category) => (
                <div key={category.id} className="doc-index-card">
                  <div className="doc-index-card-body">
                    <strong>{category.title}</strong>
                    <span>
                      {category.summary} ({category.criteria.length} criteria,{" "}
                      {category.criteria.filter((c) => c.required).length} required)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Live checklist</div>
              <h2 className="section-title">Walk through the checklist.</h2>
              <p className="section-desc">
                Click a status to mark a criterion. Approval requires every required criterion to
                pass — try failing one to see it block.
              </p>
            </div>
            <ReviewChecklist />
            <div className="page-actions">
              <a href="/developers/analytics" className="btn btn--primary">
                Next: analytics
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
