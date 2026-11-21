import "../../styles/pages.css"

import { PricingSection } from "@/components/site/pricing-section"
import { pricingFaqs, pricingStats } from "@/lib/pricing"
import { createPageMetadata } from "@/lib/seo"
import { createFaqPageJsonLd, serializeJsonLd } from "@/lib/structured-data"
import { PageTransition } from "@/components/view-transitions/view-transitions"

const description =
  "Spindle is free for one researcher with 5 GB of storage. Team and Enterprise plans add shared workspaces, more storage, and dedicated support."

export const metadata = createPageMetadata({
  title: "Pricing — Spindle",
  description,
  path: "/pricing",
})

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string | string[] }>
}) {
  // Read ?billing= on the server so PricingSection's first client render
  // already shows the right period — no post-hydration re-render.
  const { billing } = await searchParams
  const initialBilling = billing === "yearly" || billing === "monthly" ? billing : undefined
  return (
    <PageTransition>
      {/* FAQPage JSON-LD mirrors the pricingFaqs array rendered by
          PricingSection below; the shared graph in the site layout already
          covers Organization/WebSite/SoftwareApplication. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(createFaqPageJsonLd(pricingFaqs, "/pricing")),
        }}
      />
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Pricing</div>
            <h1 className="page-title">Start free, bring a project</h1>
            <p className="page-lede">
              The full workspace, 5 GB of storage, and 20 agent requests a day — no credit card.
              Bigger research groups can add seats, storage, and shared controls.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="stats-grid">
              {pricingStats.map((stat) => (
                <div className="stat" key={stat.label}>
                  <div className="stat-value">
                    {stat.value}
                    {stat.suffix ? <span className="stat-suffix">{stat.suffix}</span> : null}
                  </div>
                  <p>{stat.label}</p>
                </div>
              ))}
            </div>
            <PricingSection initialBilling={initialBilling} />
            <div className="referral-note">
              <svg className="icon icon--xs" aria-hidden="true">
                <use href="#i-users" />
              </svg>{" "}
              Refer a friend and get <strong>+50 agent requests</strong>, one time, when they create
              an account with your link.{" "}
              <a href="/referral">
                See how it works{" "}
                <svg className="icon icon--xs" aria-hidden="true">
                  <use href="#i-arrow-right" />
                </svg>
              </a>
            </div>
          </div>
        </section>
        <section className="cta-section">
          <div className="container">
            <div className="cta-box">
              <h2>Give your research a place to live.</h2>
              <p>Start with 5 GB, a lab, local search, and 20 agent requests a day.</p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Create free workspace
                </a>
                <a href="/about#contact" className="btn btn--ghost btn--lg">
                  Talk to us
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
