import type { Metadata } from "next"
import Link from "next/link"

import "@/app/styles/pages.css"

import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata: Metadata = {
  title: "Page not found — Spindle",
  description:
    "The page you are looking for does not exist. Head back to Spindle, read the docs, or search the site.",
}

export default function SiteNotFound() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <section className="error-page">
          <div className="container">
            <p className="error-code">404 — page not found</p>
            <h1 className="page-title">This page isn&rsquo;t in the notebook.</h1>
            <p className="page-lede">
              The link may be old, or the page may have moved. The rest of the workspace is still
              here — start from home, the docs, or search.
            </p>

            <div className="page-actions">
              <Link href="/" className="btn btn--primary">
                Back to home
              </Link>
              <Link href="/docs" className="btn btn--ghost">
                Read the docs
              </Link>
              <Link href="/pricing" className="btn btn--ghost">
                Pricing
              </Link>
            </div>

            <nav className="error-quick-links" aria-label="More places to look">
              <span>Also try</span>
              <Link href="/#search">Search the site</Link>
              <Link href="/changelog">Changelog</Link>
              <Link href="/platform">Platform overview</Link>
            </nav>

            <p className="error-signin">
              Already have a workspace?{" "}
              <Link href="/sign-in" className="text-link">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
