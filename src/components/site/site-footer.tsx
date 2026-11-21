"use client"

import { useLanguage } from "@/components/i18n/language-provider"
import { CookieSettingsButton } from "@/components/site/cookie-settings-button"
import { NewsletterForm } from "@/components/site/newsletter-form"
import { SocialLinks } from "@/components/site/social-links"

type FooterLink = { href: string; labelKey: string }

const footerColumns: { headingKey: string; links: FooterLink[] }[] = [
  {
    headingKey: "nav.product",
    links: [
      { href: "/platform", labelKey: "footer.platformOverview" },
      { href: "/files", labelKey: "nav.link.files" },
      { href: "/lab", labelKey: "footer.lab" },
      { href: "/search", labelKey: "footer.search" },
      { href: "/automations", labelKey: "nav.link.automations" },
      { href: "/infrastructure", labelKey: "nav.link.infrastructure" },
      { href: "/pricing", labelKey: "nav.pricing" },
    ],
  },
  {
    headingKey: "footer.workspace",
    links: [
      { href: "/#integrations", labelKey: "footer.integrations" },
      { href: "/agent", labelKey: "nav.link.agent" },
      { href: "/#chat", labelKey: "nav.link.teamChat" },
      { href: "/collaboration", labelKey: "nav.link.collaboration" },
      { href: "/sign-up", labelKey: "footer.getStarted" },
      { href: "/referral", labelKey: "footer.referFriend" },
    ],
  },
  {
    headingKey: "nav.resources",
    links: [
      { href: "/docs", labelKey: "nav.link.documentation" },
      { href: "/docs/quickstart", labelKey: "nav.link.quickstart" },
      { href: "/docs/guides", labelKey: "nav.link.guides" },
      { href: "/changelog", labelKey: "nav.changelog" },
      { href: "/docs/faq", labelKey: "nav.link.faq" },
    ],
  },
  {
    headingKey: "nav.company",
    links: [
      { href: "/about", labelKey: "nav.link.about" },
      { href: "/contact", labelKey: "nav.link.contact" },
      { href: "/terms", labelKey: "footer.terms" },
      { href: "/privacy", labelKey: "footer.privacy" },
      { href: "/cookies", labelKey: "footer.cookiePolicy" },
      { href: "/acceptable-use", labelKey: "footer.acceptableUse" },
      { href: "/dpa", labelKey: "footer.dpa" },
      { href: "/security", labelKey: "footer.security" },
      { href: "/accessibility", labelKey: "footer.accessibility" },
      {
        href: "https://github.com/spindle-labs/spindle",
        labelKey: "footer.github",
      },
    ],
  },
]

export function SiteFooter() {
  const { t } = useLanguage()

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="/" className="brand" aria-label={t("nav.home")}>
              <span className="brand-mark">
                <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <path
                    d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="22" r="2.2" fill="currentColor" />
                </svg>
              </span>
              <span className="brand-name">spindle</span>
            </a>
            <p>{t("footer.tagline")}</p>
            <div className="socials">
              <SocialLinks />
            </div>
          </div>
          <div className="footer-links">
            {footerColumns.map((column) => (
              <div className="footer-col" key={column.headingKey}>
                <h2>{t(column.headingKey)}</h2>
                {column.links.map((link) =>
                  link.href.startsWith("https://") ? (
                    <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
                      {t(link.labelKey)} ↗
                    </a>
                  ) : (
                    <a key={link.href} href={link.href}>
                      {t(link.labelKey)}
                    </a>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="footer-newsletter" id="newsletter">
          <NewsletterForm />
        </div>
        <div className="footer-bottom">
          {/* The year is evaluated at render time on both sides; near a year
              boundary (or across server/client timezones) the prerendered text
              can differ from the hydration render, so the mismatch is
              suppressed on this one node only. */}
          <span suppressHydrationWarning>
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </span>
          <div className="footer-bottom-actions">
            <CookieSettingsButton className="footer-cookie-settings" />
          </div>
        </div>
      </div>
    </footer>
  )
}
