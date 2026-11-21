import "../../styles/pages.css"

import { PricingFaq } from "@/components/site/pricing-faq"
import { PricingSection } from "@/components/site/pricing-section"
import { PageTransition } from "@/components/view-transitions/view-transitions"
import {
  donationEmail,
  fundingAreas,
  pricingFaqs,
  pricingStats,
  supportOptions,
} from "@/lib/pricing"
import { createPageMetadata } from "@/lib/seo"
import { createFaqPageJsonLd, serializeJsonLd } from "@/lib/structured-data"

const description =
  "Spindle is free forever: every feature, 5 GB of storage, and real-time collaboration on the $0 Hobby plan. Donations fund the servers and development; Enterprise is a custom agreement."

export const metadata = createPageMetadata({
  title: "Pricing — Spindle",
  description,
  path: "/pricing",
})

const enterpriseIncludes = [
  "Dedicated infrastructure and an uptime SLA",
  "SSO, audit logs, and role controls",
  "Custom storage and agent allowances",
  "Onboarding and training for your organization",
  "Custom integrations and workflows",
  "A countersigned DPA and subprocessor list",
]

const promises = [
  {
    title: "Donations stay tied to the work.",
    body: "They pay for Spindle's infrastructure and development. They are not a subscription, and they do not buy equity, control, or a different product.",
  },
  {
    title: "Nothing free gets taken away.",
    body: "Features that are free today stay free. If that ever has to change, we will say so publicly and give every workspace time, notice, and an export path.",
  },
  {
    title: "You can ask where the money went.",
    body: "Email us and we will explain the current costs in plain language — servers, storage, services, and the work in progress.",
  },
  {
    title: "No dark patterns.",
    body: "No fake countdowns, no trial that quietly becomes a charge, no 'contact sales' wall in front of basic features, and no confusing per-seat maths.",
  },
]

export default function PricingPage() {
  return (
    <PageTransition>
      {/* FAQPage JSON-LD mirrors the pricingFaqs array rendered by
          PricingFaq below; the shared graph in the site layout already
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
            <h1 className="page-title">Free forever, funded by the people who use it</h1>
            <p className="page-lede">
              Spindle has no paid plans. The Hobby plan is $0 with every feature switched on —
              files, Lab, Search, Agent, chat, and real-time collaboration. Donations pay for the
              servers and the work it takes to keep it running.
            </p>
            <div className="page-actions">
              <a href="/sign-up" className="btn btn--primary btn--lg">
                Create free workspace
              </a>
              <a href="#how-spindle-is-funded" className="btn btn--ghost btn--lg">
                See how it&apos;s funded
              </a>
            </div>
          </div>
        </section>

        <section className="section" id="plans">
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
            <div className="section-head pricing-plans-head">
              <div className="eyebrow">The plans</div>
              <h2 className="section-title">One free plan. One custom agreement.</h2>
              <p className="section-desc">
                Hobby is the whole product at $0, not a stripped-down demo. Enterprise is the only
                paid arrangement: a scoped contract for organizations that need dedicated
                infrastructure, security controls, and a name on the SLA.
              </p>
            </div>
            <PricingSection />
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

        <section className="section section--alt" id="how-spindle-is-funded">
          <div className="pricing-story container">
            <div className="eyebrow">The honest version</div>
            <h2 className="section-title">There is no paid tier. There is a server bill.</h2>
            <p>
              Most research tools start free and then gate the useful parts: more storage, more
              collaborators, a higher agent allowance, the export button. Spindle went the other
              way. Everything the product does is available on the $0 plan. There is no Team tier,
              no per-seat invoice, and no upgrade button waiting at the end of a trial.
            </p>
            <p>
              That only works because of donations. Servers, storage, bandwidth, backups, and the
              hours spent building and maintaining Spindle are paid for by people who find it useful
              and choose to chip in. Nobody is required to donate, and no feature is held hostage
              behind a payment form. The free plan is the product — the donation link is simply
              there for anyone who wants it to keep existing.
            </p>
            <blockquote className="pricing-pullquote">
              No ads. No data sales. No feature gates. No per-seat pricing.
            </blockquote>
            <p>
              When donations cover the costs, the free plan stays free and the infrastructure grows
              with the people using it. When they don&apos;t, we say so and adjust honestly rather
              than quietly moving features behind a paywall. That is a harder way to run software,
              but it keeps the incentive pointed at the work instead of at expansion revenue.
            </p>
          </div>
        </section>

        <section className="section" id="where-donations-go">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Where the money goes</div>
              <h2 className="section-title">Donations pay for four unglamorous things.</h2>
              <p className="section-desc">
                There is no growth team or ad budget to fund. The costs are the costs of running a
                real workspace for real projects — and of fixing it when something breaks.
              </p>
            </div>
            <div className="pricing-funding-grid">
              {fundingAreas.map((area) => (
                <article className="pricing-funding-card" key={area.title}>
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href={`#${area.icon}`} />
                    </svg>
                  </span>
                  <h3>{area.title}</h3>
                  <p>{area.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--alt" id="why-free">
          <div className="pricing-story container">
            <div className="eyebrow">Why not just sell a subscription?</div>
            <h2 className="section-title">A pricing page shapes the product behind it.</h2>
            <p>
              A subscription would be simpler to run. It would also change who the product is for.
              Per-seat plans push teams to optimise for administrators, storage caps, and expansion
              revenue. Spindle is built for the person with a folder of data and a question — the
              researcher who needs the Lab at 2 a.m., the student who cannot expense a licence, the
              small group that just wants to look at the same files.
            </p>
            <p>
              Donations keep the incentive pointed at the work. If Spindle is useful, people support
              it. If it is not, they do not. That is a more direct signal than an annual renewal
              nobody remembers approving.
            </p>
            <ul className="pricing-principles">
              <li>
                <span>
                  <strong>Every feature is free.</strong> There is no paid unlock, no seat minimum,
                  and no feature that only appears after an upgrade.
                </span>
              </li>
              <li>
                <span>
                  <strong>No ads and no data sales.</strong> Donations replace the revenue an ad or
                  data business would need, so your research never becomes the product.
                </span>
              </li>
              <li>
                <span>
                  <strong>Limits are infrastructure, not leverage.</strong> Storage and agent
                  allowances exist because compute costs money, not to push you toward a plan.
                </span>
              </li>
              <li>
                <span>
                  <strong>Your work stays portable.</strong> Files and lab outputs can be exported
                  whenever you want, with or without a donation.
                </span>
              </li>
              <li>
                <span>
                  <strong>The free plan is the product.</strong> Hobby is not a demo that expires;
                  it is the same workspace everyone uses.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="section" id="enterprise">
          <div className="pricing-split container">
            <div>
              <div className="eyebrow">The one exception</div>
              <h2 className="section-title">Enterprise is custom, not a subscription.</h2>
              <p>
                Organizations have needs a free workspace cannot meet: a contract to sign,
                infrastructure that is dedicated rather than shared, SSO and audit logs, a named
                uptime commitment, and someone to call during onboarding. That work is scoped and
                priced per organization as a custom agreement.
              </p>
              <p>
                Enterprise does not create a consumer paid tier, and it does not gate features that
                Hobby already includes. It pays for the extra operational work an organization asks
                us to take on — dedicated capacity, compliance paperwork, migration help, and
                training — so the free plan can stay free.
              </p>
              <div className="page-actions">
                <a href="/contact" className="btn btn--primary btn--lg">
                  Talk about Enterprise
                </a>
                <a href="/security" className="btn btn--ghost btn--lg">
                  Read the trust centre
                </a>
              </div>
            </div>
            <aside className="pricing-enterprise-card" aria-label="Enterprise includes">
              <h3>What a custom agreement can include</h3>
              <ul>
                {enterpriseIncludes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p>
                Already have a scope in mind? <a href="/contact">Send the details</a> and we will
                come back with a quote.
              </p>
            </aside>
          </div>
        </section>

        <section className="section section--alt" id="support">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Keep the lights on</div>
              <h2 className="section-title">If Spindle saves you time, put something back.</h2>
              <p className="section-desc">
                Every contribution goes to the same place: the cost of running and improving the
                product. Pick whichever way of helping fits — money is useful, but it is not the
                only way to support a project.
              </p>
            </div>
            <div className="pricing-support-grid">
              {supportOptions.map((option) => (
                <article className="pricing-support-card" key={option.title}>
                  <span className="card-icon">
                    <svg className="icon" aria-hidden="true">
                      <use href={`#${option.icon}`} />
                    </svg>
                  </span>
                  <h3>{option.title}</h3>
                  <p>{option.body}</p>
                  <a
                    className="text-link"
                    href={option.cta.href}
                    {...(option.cta.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {option.cta.label}{" "}
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href={option.cta.external ? "#i-arrow-up-right" : "#i-arrow-right"} />
                    </svg>
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="promise">
          <div className="pricing-story container">
            <div className="eyebrow">Our side of the deal</div>
            <h2 className="section-title">What a donation does — and does not — buy.</h2>
            <p>
              A donation is not a subscription with extra steps. It does not unlock a secret tier,
              change your storage, or give anyone a vote on the roadmap. It buys the boring things
              that let the free plan exist, and it comes with a few promises about how we behave in
              return.
            </p>
            <ul className="pricing-principles">
              {promises.map((promise) => (
                <li key={promise.title}>
                  <span>
                    <strong>{promise.title}</strong> {promise.body}
                  </span>
                </li>
              ))}
            </ul>
            <p className="pricing-small-note">
              Spindle is an independent project, not a registered charity, so donations are not
              tax-deductible. If that ever changes, it will be stated here first.
            </p>
          </div>
        </section>

        <section className="section section--alt" id="faq">
          <div className="container">
            <PricingFaq />
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <div className="cta-box">
              <div className="eyebrow">No card. No trial clock.</div>
              <h2>Start free. Donate only if it earns it.</h2>
              <p>
                Put a real project into Spindle first. If the workspace, the Lab, and the agent save
                you time, you will know where the donation link is.
              </p>
              <div className="cta-actions">
                <a href="/sign-up" className="btn btn--primary btn--lg">
                  Create free workspace
                </a>
                <a href={donationEmail} className="btn btn--ghost btn--lg">
                  Support Spindle
                </a>
                <a href="/contact" className="btn btn--ghost btn--lg">
                  Talk about Enterprise
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
