import "../../../styles/pages.css"

import { PermissionsManager } from "@/components/apps/permissions-manager"
import { DeveloperNav } from "@/components/apps/developer-nav"
import { APP_ROLES, APP_SCOPES, ROLE_SCOPES } from "@/lib/apps/permissions"
import { createPageMetadata } from "@/lib/seo"
import { PageTransition } from "@/components/view-transitions/view-transitions"

export const metadata = createPageMetadata({
  title: "Permissions & scopes — Spindle Developers",
  description:
    "The app permission model: scope catalog, role mapping, grant and revoke semantics, expiry, and wildcard rules.",
  path: "/developers/permissions",
})

export default function PermissionsPage() {
  return (
    <PageTransition>
      <main id="top" tabIndex={-1} className="page-main">
        <DeveloperNav />
        <section className="page-hero">
          <div className="container">
            <div className="eyebrow">Permissions &amp; scopes</div>
            <h1 className="page-title">Ask for the least you need.</h1>
            <p className="page-lede">
              Apps request scopes like <code>files:read</code>. Each grant can be limited to
              specific roles and can expire. Wildcards (<code>files:*</code>, <code>*</code>) exist
              for internal tooling but are flagged during review.
            </p>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Scope catalog</div>
              <h2 className="section-title">What an app can ask for.</h2>
            </div>
            <div className="doc-content">
              <table>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Viewer</th>
                    <th>Member</th>
                    <th>Admin</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {APP_SCOPES.map((scope) => (
                    <tr key={scope}>
                      <td>
                        <code>{scope}</code>
                      </td>
                      {APP_ROLES.map((role) => (
                        <td key={role}>{ROLE_SCOPES[role].includes(scope) ? "✓" : "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        <section className="section section--alt">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Semantics</div>
              <h2 className="section-title">How grants behave.</h2>
            </div>
            <div className="doc-content">
              <ul>
                <li>
                  <strong>Exact and wildcard matching.</strong> A grant for <code>files:*</code>{" "}
                  covers <code>files:read</code> and <code>files:write</code>; <code>*</code> covers
                  everything and is reserved for first-party apps.
                </li>
                <li>
                  <strong>Role restrictions.</strong> A grant may name the roles allowed to use it.
                  Omitting roles means every role may use it.
                </li>
                <li>
                  <strong>Expiry.</strong> Grants can carry an <code>expiresAt</code> timestamp;
                  expired grants fail authorization checks automatically.
                </li>
                <li>
                  <strong>Revoke.</strong> Revoking removes the grant immediately; there is no grace
                  period.
                </li>
              </ul>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="section-head">
              <div className="eyebrow">Try it</div>
              <h2 className="section-title">Grant and revoke scopes for a demo app.</h2>
              <p className="section-desc">
                This manager persists grants in your browser&apos;s localStorage — the same store
                the permissions library uses. Nothing leaves your machine.
              </p>
            </div>
            <PermissionsManager appId="portal-demo" previewRole="member" />
            <div className="page-actions">
              <a href="/developers/review" className="btn btn--primary">
                Next: review process
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageTransition>
  )
}
