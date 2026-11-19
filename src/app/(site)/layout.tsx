import type { Metadata, Viewport } from "next"

import "@/app/styles/index.css"
import "@/app/styles/ui.css"
import "@/app/styles/styles.css"
import "@/app/styles/auth.css"

import { CookieConsent } from "@/components/site/cookie-consent"
import { Providers } from "@/components/site/providers"
import { IconSprite } from "@/components/site/icon-sprite"
import { SiteFooter } from "@/components/site/site-footer"
import { SiteHeader } from "@/components/site/site-header"
import { SiteInteractions } from "@/components/site/site-interactions"

export const metadata: Metadata = {
  title: "Spindle — One place for all your research",
  description:
    "Spindle gives every research project its own home: files, a live lab, local search, automations, an agent, and real-time team collaboration. 5 GB free.",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0f0e",
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <CookieConsent>
            <IconSprite />
            <SiteHeader />
            {children}
            <SiteFooter />
          </CookieConsent>
        </Providers>
        <SiteInteractions />
      </body>
    </html>
  )
}
