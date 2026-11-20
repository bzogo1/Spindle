import "../../styles/pages.css"

import { DeveloperNav } from "@/components/apps/developer-nav"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Developers — Spindle",
  description:
    "Build on Spindle: authentication, scoped app permissions, analytics, the app review process, and an interactive API playground.",
  path: "/developers",
})

const SECTIONS = [
  {
    href: "/developers/getting-started",
    title: "Getting started",
    body: "Register an app, pick your auth flow, and make your first authenticated call in a few minutes.",
  },
  {
    href: "/developers/authentication",
    title: "Authentication",
    body: "Session cookies, OAuth providers, passwordless, and two-factor flows — what each endpoint expects.",
  },
  {
    href: "/developers/permissions",
    title: "Permissions & scopes",
    body: "The scope catalog, role mapping, grant/revoke semantics, and expiry rules for third-party apps.",
  },
  {
    href: "/developers/review",
    title: "App review",
    body: "The checklist every submitted app passes through: security, permission scope, UX, and performance.",
  },
  {
    href: "/developers/analytics",
    title: "Analytics",
    body: "Track events from your app and read aggregate stats — the same model the portal demos live.",
  },
  {
    href: "/developers/playground",
    title: "API playground",
    body: "Send real requests against the same-origin API, inspect responses, and keep a local call history.",
  },
]

export default function DevelopersPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Developers</div>
            <h1 className="page-title">Build apps on Spindle.</h1>
            <p className="page-lede">
              Everything you need to integrate: how authentication works, which scopes your app can
              request, how submissions are reviewed, and a playground that talks to the real API.
            </p>
            <div className="page-actions">
              <a href="/developers/getting-started" className="btn btn--primary">
                Get started
              </a>
              <a href="/developers/playground" className="btn btn--ghost">
                Open the playground
              </a>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Portal sections</div>
              <h2 className="section-title">Six stops from idea to approved app.</h2>
            </div>
            <div className="doc-guides">
              {SECTIONS.map((section) => (
                <a key={section.href} href={section.href} className="doc-index-card">
                  <div className="doc-index-card-body">
                    <strong>{section.title}</strong>
                    <span>{section.body}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Quick links</div>
              <h2 className="section-title">Jump straight in.</h2>
            </div>
            <div className="doc-guides">
              <a href="/docs/quickstart" className="doc-index-card">
                <div className="doc-index-card-body">
                  <strong>Quickstart guide</strong>
                  <span>Create a workspace and add your first files.</span>
                </div>
              </a>
              <a href="/developers/changelog" className="doc-index-card">
                <div className="doc-index-card-body">
                  <strong>Developer changelog</strong>
                  <span>What changed in the API and the portal.</span>
                </div>
              </a>
              <a href="/contact" className="doc-index-card">
                <div className="doc-index-card-body">
                  <strong>Contact us</strong>
                  <span>Questions about app review or partnerships.</span>
                </div>
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
