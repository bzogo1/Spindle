import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Page not found — Changelog",
}

export default function ChangelogNotFound() {
  return (
    <div className="cl-page">
      <div className="cl-topbar">
        <div className="cl-shell cl-topbar-inner">
          <p className="cl-page-title">Changelog</p>
        </div>
      </div>
      <main id="main-content" tabIndex={-1} className="cl-shell cl-content">
        <div className="cl-state">
          <p className="cl-state-code">404 — page not found</p>
          <h1 className="cl-state-title">This changelog entry doesn&rsquo;t exist.</h1>
          <p className="cl-state-text">
            The release may have been renamed, or the link is out of date. Every published release
            is still on the changelog page.
          </p>
          <div className="cl-state-actions">
            <Link href="/changelog" className="cl-state-btn cl-state-btn--primary">
              Back to the changelog
            </Link>
            <Link href="/" className="cl-state-btn">
              Back to Spindle
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
