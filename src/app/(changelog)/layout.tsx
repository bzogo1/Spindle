import type { Metadata, Viewport } from "next"

import "@/app/styles/changelog.css"

import { ChangelogInteractions } from "@/components/site/changelog-interactions"
import { OfflineIndicator } from "@/components/pwa/offline-status"
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration"
import { CookieConsent } from "@/components/site/cookie-consent"
import { Toaster } from "@/components/ui/toast"
import { siteUrl } from "@/lib/changelog"
import { PrePaintScripts } from "@/components/site/pre-paint-scripts"
import { createPageMetadata } from "@/lib/seo"
import { createStructuredDataGraph, serializeJsonLd } from "@/lib/structured-data"

export const metadata: Metadata = {
  ...createPageMetadata({
    title: "Changelog",
    description: "What shipped and what changed in Spindle.",
    path: "/changelog",
  }),
  manifest: "/manifest.webmanifest",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
}

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline theme script below sets `class="dark"` before hydration, so the
    // server HTML never matches the client on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-paint theme/locale boot scripts — SSR-only (see component). */}
        <PrePaintScripts />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(createStructuredDataGraph()) }}
        />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Spindle changelog"
          href={`${siteUrl}/changelog/feed.xml`}
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {/* The changelog loads the same Sentry client, including replay, so it
            mounts the consent banner and settings dialog too. */}
        <CookieConsent appearance="changelog">{children}</CookieConsent>
        <ChangelogInteractions />
        <ServiceWorkerRegistration />
        <OfflineIndicator />
        <Toaster />
      </body>
    </html>
  )
}
