import { ContactForm } from "@/components/site/contact-form"
import { createPageMetadata } from "@/lib/seo"

import "../../styles/pages.css"
import { PageTransition } from "@/components/view-transitions/view-transitions"

const description =
  "Questions about Spindle, onboarding, or a walkthrough of your team's workflow? Send us a message."

export const metadata = createPageMetadata({
  title: "Contact — Spindle",
  description,
  path: "/contact",
})

export default function ContactPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Contact</div>
            <h1 className="page-title">Talk to a human.</h1>
            <p className="page-lede">
              Product questions, onboarding, security reviews, or a walkthrough of your team&apos;s
              workflow — send a note and we&apos;ll get back to you.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="contact-page-grid container">
            <div className="contact-aside">
              <h2 className="section-title">Other ways to reach us</h2>
              <p className="section-desc">
                Prefer email? Write directly, or start a free workspace and see how it feels — five
                gigabytes are free.
              </p>
              <div className="contact-grid">
                <div className="contact-card">
                  <span className="card-icon">
                    <svg className="icon icon--sm" aria-hidden="true">
                      <use href="#i-message" />
                    </svg>
                  </span>
                  <h3>Send an email</h3>
                  <p>For anything that needs a thread — pricing, procurement, or a demo.</p>
                  <a className="text-link" href="mailto:hello@spindle.example">
                    hello@spindle.example{" "}
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                </div>
                <div className="contact-card">
                  <span className="card-icon">
                    <svg className="icon icon--sm" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                  <h3>Start free</h3>
                  <p>The fastest way to understand Spindle is to put a real project in it.</p>
                  <a className="text-link" href="/sign-up">
                    Create a free workspace{" "}
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                </div>
                <div className="contact-card">
                  <span className="card-icon">
                    <svg className="icon icon--sm" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </span>
                  <h3>Visit the Help Center</h3>
                  <p>Searchable guides for setup, billing, security, and the API.</p>
                  <a className="text-link" href="/help">
                    Browse help articles{" "}
                    <svg className="icon icon--xs" aria-hidden="true">
                      <use href="#i-arrow-right" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
            <div className="contact-form-wrap">
              {/* The form posts via fetch, so it can't send without
                  JavaScript — point no-JS visitors at the email card. */}
              <noscript>
                <p className="form-hint">
                  JavaScript is disabled, so the form below can&apos;t send. Use the email option
                  instead: <a href="mailto:hello@spindle.example">hello@spindle.example</a>.
                </p>
              </noscript>
              <ContactForm />
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
