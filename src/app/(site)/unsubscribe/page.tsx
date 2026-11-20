import type { Metadata } from "next"

import { UnsubscribeForm } from "@/components/site/unsubscribe-form"
import { PageTransition } from "@/components/view-transitions/view-transitions"

import "../../styles/pages.css"

export const metadata: Metadata = {
  title: "Unsubscribe — Spindle",
  description: "Manage your Spindle email subscription preferences.",
  // Tokenized links must never be indexed.
  robots: { index: false, follow: false },
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; email?: string | string[] }>
}) {
  const params = await searchParams
  const token = first(params.token)
  const email = first(params.email)

  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Email preferences</div>
            <h1 className="page-title">Unsubscribe.</h1>
            <p className="page-lede">
              Review the address below and confirm to stop these emails. You can subscribe again
              anytime from the footer form.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <noscript>
              <p className="form-hint">
                JavaScript is disabled, so this page can&apos;t confirm for you. Email{" "}
                <a href="mailto:hello@spindle.example">hello@spindle.example</a> and ask to be
                removed from our list.
              </p>
            </noscript>
            <UnsubscribeForm token={token} email={email} />
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
