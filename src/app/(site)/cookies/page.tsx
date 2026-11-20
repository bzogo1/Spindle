import "../../styles/pages.css"
import "../../styles/legal.css"

import { LegalPage } from "@/components/site/legal-page"
import { CookieSettingsButton } from "@/components/site/cookie-settings-button"
import { cookiesDocument } from "@/content/legal/cookies"
import { createPageMetadata } from "@/lib/seo"

export const metadata = createPageMetadata({
  title: "Cookie Policy — Spindle",
  description:
    "Every cookie and storage key Spindle sets, its purpose, provider, category, and lifetime, and how to change your consent choice.",
  path: "/cookies",
})

export default function CookiesPage() {
  return (
    <LegalPage content={cookiesDocument}>
      <section id="manage-choice" className="legal-block">
        <h2>Manage your choice</h2>
        <p>
          The banner is hidden on this page so the policy stays readable, but the settings dialog
          works here like everywhere else on the site. Open it to review each category, change your
          choice, or withdraw consent — the change applies immediately without a reload.
        </p>
        <p>
          <CookieSettingsButton className="btn btn--primary" label="Open cookie settings" />
        </p>
      </section>
    </LegalPage>
  )
}
