import type { Metadata, Viewport } from "next"

import * as Sentry from "@sentry/nextjs"

import "@/app/styles/changelog.css"

import { ChangelogInteractions } from "@/components/site/changelog-interactions"
import { CookieConsent } from "@/components/site/cookie-consent"
import { siteUrl } from "@/lib/changelog"

export const metadata: Metadata = {
  title: "Changelog",
  description: "What shipped and what changed in Spindle.",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
}

// Applied before paint so the page never flashes the wrong theme.
const themeScript = `(function () {
  try {
    var saved = localStorage.getItem('changelog-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    if (window.Sentry) {
      window.Sentry.captureException(e);
    }
  }
})();`

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Spindle changelog"
          href={`${siteUrl}/changelog/feed.xml`}
        />
      </head>
      <body>
        {/* The changelog loads the same Sentry client, including replay, so it
            mounts the consent banner and settings dialog too. */}
        <CookieConsent appearance="changelog">{children}</CookieConsent>
        <ChangelogInteractions />
      </body>
    </html>
  )
}
