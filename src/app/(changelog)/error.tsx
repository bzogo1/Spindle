"use client"

import Link from "next/link"

import { ChangelogThemeToggle } from "@/components/site/changelog-theme-toggle"
import { useErrorReference } from "@/components/site/use-error-reference"

export default function ChangelogError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { reference, copied, copyReference } = useErrorReference(error)

  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div className="cl-shell cl-topbar-inner">
          <p className="cl-page-title">Changelog</p>
          <ChangelogThemeToggle />
        </div>
      </div>
      <main id="main-content" tabIndex={-1} className="cl-shell cl-content">
        <div className="cl-state">
          <p className="cl-state-code">Unexpected error</p>
          <h1 className="cl-state-title">This page hit a snag.</h1>
          <p className="cl-state-text">
            The rest of the changelog is still here. Try loading the page again, or head back to
            Spindle while we look into it.
          </p>
          <div className="cl-state-actions">
            <button
              type="button"
              className="cl-state-btn cl-state-btn--primary"
              onClick={() => retry()}
            >
              Try again
            </button>
            <Link href="/" className="cl-state-btn">
              Back to Spindle
            </Link>
            <Link href="/about#contact" className="cl-state-btn">
              Contact support
            </Link>
          </div>
          <p className="cl-state-reference">
            {reference ? (
              <>
                <span>
                  Error reference <code>{reference}</code>
                </span>
                <button type="button" className="cl-state-copy" onClick={copyReference}>
                  {copied ? "Copied" : "Copy error reference"}
                </button>
              </>
            ) : (
              <span>No error reference is available for this failure.</span>
            )}
            <span className="cl-sr-only" role="status" aria-live="polite">
              {copied ? "Copied to clipboard." : ""}
            </span>
          </p>
        </div>
      </main>
    </div>
  )
}
