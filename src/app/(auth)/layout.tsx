import type { Metadata, Viewport } from "next"

import "@/app/styles/index.css"
import "@/app/styles/ui.css"
// styles.css + auth.css are intentionally NOT imported here: they load
// asynchronously via DeferredStylesLoader so they don't block first paint.
// Above-the-fold styling comes from the inlined critical CSS below.

import { AUTH_CRITICAL_CSS } from "@/lib/critical-css"
import { DeferredStylesLoader } from "@/components/site/deferred-styles-loader"
import { LanguageProvider } from "@/components/i18n/language-provider"
import { OfflineIndicator } from "@/components/pwa/offline-status"
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration"
import { PrePaintScripts } from "@/components/site/pre-paint-scripts"
import { Toaster } from "@/components/ui/toast"

export const metadata: Metadata = {
  title: {
    default: "Account — Spindle",
    template: "%s — Spindle",
  },
  description: "Account recovery and email verification for Spindle.",
  robots: {
    index: false,
    follow: false,
  },
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

/** Minimal root layout for account recovery: brand mark only, no site chrome. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // No server-side locale read here (see the (site) layout): the boot
  // script fixes <html lang> pre-paint and the provider detects on mount.
  return (
    // The inline theme script below sets `class="dark"` before hydration, so
    // the server HTML never matches the client on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-paint theme/locale boot scripts — SSR-only (see component). */}
        <PrePaintScripts />
        {/* Above-fold CSS, inlined so first paint doesn't wait for the
            deferred styles.css/auth.css chunk. Keep in sync with
            src/lib/critical-css.ts. */}
        <style dangerouslySetInnerHTML={{ __html: AUTH_CRITICAL_CSS }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="auth-body">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div className="auth-glow" aria-hidden="true" />
        <LanguageProvider>{children}</LanguageProvider>
        <ServiceWorkerRegistration />
        <OfflineIndicator />
        <DeferredStylesLoader />
        <Toaster />
      </body>
    </html>
  )
}
