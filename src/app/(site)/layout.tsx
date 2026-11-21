import type { Metadata, Viewport } from "next"

import "@/app/styles/index.css"
import "@/app/styles/ui.css"
import "@/app/styles/print.css"
// styles.css + auth.css are intentionally NOT imported here: they load
// asynchronously via DeferredStylesLoader so they don't block first paint.
// Above-the-fold styling comes from the inlined critical CSS below.
import "@/app/styles/view-transitions.css"

import { siteUrl } from "@/lib/changelog"
import { SITE_CRITICAL_CSS } from "@/lib/critical-css"
import { createStructuredDataGraph, serializeJsonLd } from "@/lib/structured-data"
import { PrePaintScripts } from "@/components/site/pre-paint-scripts"
import { AnalyticsPageView } from "@/components/site/analytics-pageview"
import { CookieConsent } from "@/components/site/cookie-consent"
import { DeferredStylesLoader } from "@/components/site/deferred-styles-loader"
import { InternalLinkNavigation } from "@/components/site/internal-link-navigation"
import { InstallPrompt } from "@/components/pwa/install-prompt"
import { OfflineIndicator } from "@/components/pwa/offline-status"
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration"
import { LanguageProvider } from "@/components/i18n/language-provider"
import { Providers } from "@/components/site/providers"
import { IconSprite } from "@/components/site/icon-sprite"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"
import { SiteInteractions } from "@/components/site/site-interactions"
import { Toaster } from "@/components/ui/toast"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Spindle — One place for all your research",
  description:
    "Spindle gives every research project its own home: files, a live lab, local search, automations, an agent, and real-time team collaboration. 5 GB free.",
  manifest: "/manifest.webmanifest",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f0e" },
  ],
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // No server-side locale read here: cookies() would force every marketing
  // page dynamic. LOCALE_BOOT_SCRIPT fixes <html lang> pre-paint and the
  // provider resolves the locale client-side on mount.
  return (
    // The inline theme script below sets `class="dark"` before hydration, so
    // the server HTML never matches the client on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-paint theme/locale boot scripts — SSR-only (see component). */}
        <PrePaintScripts />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(createStructuredDataGraph()) }}
        />
        {/* Above-fold CSS, inlined so first paint doesn't wait for the
            deferred styles.css/auth.css chunk. Keep in sync with
            src/lib/critical-css.ts. */}
        <style dangerouslySetInnerHTML={{ __html: SITE_CRITICAL_CSS }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a href="#top" className="skip-link">
          Skip to content
        </a>
        <Providers>
          <LanguageProvider>
            <CookieConsent>
              <IconSprite />
              <SiteHeader />
              {children}
              <SiteFooter />
            </CookieConsent>
          </LanguageProvider>
        </Providers>
        <SiteInteractions />
        <AnalyticsPageView />
        <DeferredStylesLoader />
        <InternalLinkNavigation />
        <ServiceWorkerRegistration />
        <InstallPrompt />
        <OfflineIndicator />
        <Toaster />
      </body>
    </html>
  )
}
