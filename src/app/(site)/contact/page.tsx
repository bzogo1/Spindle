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
              <h2 className="section-title">We&apos;ll try to reach you ASAP</h2>
              <p className="section-desc">
                Send us a note with the form and we&apos;ll do our best to get back to you as soon
                as possible. We may not be able to answer every question immediately, but we read
                every message.
              </p>
              <p className="section-desc">
                Prefer email? Write to us directly at{" "}
                <a className="text-link" href="mailto:hello@spindle.example">
                  hello@spindle.example
                </a>
                .
              </p>
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
