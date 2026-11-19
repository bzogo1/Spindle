"use client"

import Link from "next/link"

import "@/app/styles/pages.css"

import { useErrorReference } from "@/components/site/use-error-reference"

export default function SiteError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { reference, copied, copyReference } = useErrorReference(error)

  return (
    <main id="top" className="page-main">
      <section className="error-page">
        <div className="container">
          <p className="error-code">Unexpected error</p>
          <h1 className="page-title">This page hit a snag.</h1>
          <p className="page-lede">
            The rest of the site is still here. Try loading the page again, or head back home while
            we look into it.
          </p>

          <div className="page-actions">
            <button type="button" className="btn btn--primary" onClick={() => retry()}>
              Try again
            </button>
            <Link href="/" className="btn btn--ghost">
              Back to home
            </Link>
            <Link href="/about#contact" className="btn btn--ghost">
              Contact support
            </Link>
          </div>

          <p className="error-reference">
            {reference ? (
              <>
                <span>
                  Error reference <code>{reference}</code>
                </span>
                <button type="button" onClick={copyReference}>
                  {copied ? "Copied" : "Copy error reference"}
                </button>
              </>
            ) : (
              <span>No error reference is available for this failure.</span>
            )}
            <span className="error-reference-status" role="status" aria-live="polite">
              {copied ? "Copied to clipboard." : ""}
            </span>
          </p>
        </div>
      </section>
    </main>
  )
}
