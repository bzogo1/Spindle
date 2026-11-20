import "../../../styles/pages.css"

import { ApiPlayground } from "@/components/api-playground/api-playground"
import { DeveloperNav } from "@/components/apps/developer-nav"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "API playground — Spindle Developers",
  description:
    "Send requests to the same-origin Spindle API, inspect responses, and keep a local history of calls.",
  path: "/developers/playground",
})

export default function PlaygroundPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">API playground</div>
            <h1 className="page-title">Try the real API.</h1>
            <p className="page-lede">
              Requests run against this site&apos;s own <code>/api</code> routes — same origin, no
              CORS. Session-authenticated endpoints use your <code>spindle_at</code> cookie
              automatically, so sign in first in another tab. The optional bearer field only adds an{" "}
              <code>Authorization</code> header — the API does not verify bearer tokens.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <ApiPlayground />
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
