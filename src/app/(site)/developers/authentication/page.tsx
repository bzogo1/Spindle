import "../../../styles/pages.css"

import { DeveloperNav } from "@/components/apps/developer-nav"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Authentication — Spindle Developers",
  description:
    "How apps authenticate with the Spindle API: session cookies, OAuth, passwordless, and two-factor flows.",
  path: "/developers/authentication",
})

const FLOWS = [
  {
    title: "Session cookies (browser apps)",
    body: "Sign in via POST /api/auth/signin (or /api/auth/signup). The server sets an httpOnly spindle_at session cookie; the browser sends it automatically on subsequent same-origin requests, and every route resolves the caller's identity from it. GET /api/auth/session returns the current session or 401; POST /api/auth/refresh rotates it; POST /api/auth/logout ends it.",
  },
  {
    title: "Same-origin enforcement",
    body: "Because auth is cookie-based, state-changing routes (POST/PUT/PATCH/DELETE) reject cross-origin requests — the Origin/Referer header must match this site. There are no API keys or bearer tokens: do not send Authorization headers expecting them to authenticate you.",
  },
  {
    title: "Mock session (development only)",
    body: "When the deployment enables mock auth, a spindle_mock_session cookie carries a demo identity instead of a real account. It exists for local development and demos — production routes verify the real spindle_at token.",
  },
  {
    title: "OAuth (third-party sign-in)",
    body: "GET /api/auth/oauth/{provider} starts the flow; the provider redirects back to /api/auth/oauth/callback with a code and state, and the server sets the same session cookies. Supported providers are listed in the app registration settings.",
  },
  {
    title: "Passwordless",
    body: "POST /api/auth/passwordless/request emails a one-time token; POST /api/auth/passwordless/verify exchanges it (body { token }) for a session. Useful for magic-link style sign-in.",
  },
  {
    title: "Two-factor",
    body: "TOTP enrollment and verification live under /api/auth/2fa/*. Enrollment returns a secret and QR provisioning URI; confirm with /api/auth/2fa/confirm before it activates. Sign-in then requires /api/auth/2fa/verify-login with the login challenge. Backup codes are available via GET /api/auth/2fa/backup-codes.",
  },
]

const ENDPOINTS = [
  ["POST", "/api/auth/signin", "Email + password sign-in"],
  ["POST", "/api/auth/signup", "Create account + workspace"],
  ["GET", "/api/auth/session", "Current session (401 when signed out)"],
  ["POST", "/api/auth/refresh", "Rotate session tokens"],
  ["POST", "/api/auth/logout", "End session"],
  ["POST", "/api/auth/passwordless/request", "Email sign-in token"],
  ["POST", "/api/auth/passwordless/verify", "Exchange token for session"],
  ["POST", "/api/auth/verify-email/resend", "Resend verification email (public)"],
  ["GET", "/api/auth/oauth/{provider}", "Start OAuth flow"],
  ["GET", "/api/auth/audit", "Auth event history"],
] as const

export default function AuthenticationPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Authentication</div>
            <h1 className="page-title">One session model, several ways in.</h1>
            <p className="page-lede">
              Every API route resolves the same identity from your session cookie. Pick the sign-in
              flow that matches where your users are.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Flows</div>
              <h2 className="section-title">Choose your flow.</h2>
            </div>
            <div className="doc-guides">
              {FLOWS.map((flow) => (
                <div key={flow.title} className="doc-index-card">
                  <div className="doc-index-card-body">
                    <strong>{flow.title}</strong>
                    <span>{flow.body}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Endpoints</div>
              <h2 className="section-title">Auth route reference.</h2>
            </div>
            <div className="doc-content">
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map(([method, path, description]) => (
                    <tr key={path}>
                      <td>
                        <code>{method}</code>
                      </td>
                      <td>
                        <code>{path}</code>
                      </td>
                      <td>{description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="page-actions">
              <a href="/developers/permissions" className="btn btn--primary">
                Next: permissions &amp; scopes
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
