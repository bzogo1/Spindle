import "../../../styles/pages.css"

import { DeveloperNav } from "@/components/apps/developer-nav"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Getting started — Spindle Developers",
  description:
    "Register an app, choose an authentication flow, request scopes, and make your first API call.",
  path: "/developers/getting-started",
})

const STEPS = [
  {
    title: "Create a workspace",
    body: "Sign up and create a project. Apps are always scoped to a workspace — there is no global API key.",
  },
  {
    title: "Register your app",
    body: "Give your app a name, a redirect URL for OAuth, and the list of scopes it needs. Scopes are documented on the permissions page.",
  },
  {
    title: "Pick an auth flow",
    body: "Browser apps use the session cookie set at sign-in. Third-party sign-in goes through the OAuth routes. There are no API keys or bearer tokens — the API authenticates same-origin cookie sessions.",
  },
  {
    title: "Make your first call",
    body: "Hit GET /api/auth/session to confirm auth, then GET /api/profile to read the current user. The playground can send these for you.",
  },
  {
    title: "Submit for review",
    body: "Once the integration works, submit it for review. The checklist covers security, permission scope, UX, and performance.",
  },
]

export default function GettingStartedPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Getting started</div>
            <h1 className="page-title">From zero to first API call.</h1>
            <p className="page-lede">
              Five steps take you from a fresh account to an app that reads your workspace over the
              API.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <ol className="doc-steps">
              {STEPS.map((step) => (
                <li key={step.title} className="doc-step">
                  <strong>{step.title}.</strong> {step.body}
                </li>
              ))}
            </ol>
            <div className="page-actions">
              <a href="/developers/authentication" className="btn btn--primary">
                Next: authentication
              </a>
              <a href="/developers/playground" className="btn btn--ghost">
                Try the playground
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
