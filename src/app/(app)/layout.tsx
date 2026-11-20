import type { Metadata, Viewport } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import "@/app/styles/index.css"
import "@/app/styles/ui.css"
import "@/app/styles/app.css"
import "@/app/styles/view-transitions.css"

import { AppShell } from "@/components/app/app-shell"
import { AnnouncementBanner } from "@/components/app/announcement-banner"
import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { InstallPrompt } from "@/components/pwa/install-prompt"
import { OfflineIndicator } from "@/components/pwa/offline-status"
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration"
import { AppNotificationsProvider } from "@/components/app/notifications-provider"
import { UploadQueueDock } from "@/components/uploads/upload-dock"
import { UploadsProvider } from "@/components/uploads/upload-provider"
import { IconSprite } from "@/components/site/icon-sprite"
import { LanguageProvider } from "@/components/i18n/language-provider"
import { LOCALE_BOOT_SCRIPT, LOCALE_COOKIE, matchLocale } from "@/lib/i18n/locale"
import { PrePaintScripts } from "@/components/site/pre-paint-scripts"
import { Providers } from "@/components/site/providers"
import {
  decodeMockSession,
  MOCK_SESSION_COOKIE,
  mockAuthEnabled,
  SIGN_IN_PATH,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/http"
import { verifyAuthTokenIgnoreExpiry } from "@/lib/auth/token-codec"

export const metadata: Metadata = {
  title: {
    default: "Spindle",
    template: "%s — Spindle",
  },
  description: "Your Spindle workspace.",
  // The shell is a mock until real sessions land (DEV-27); keep it out of indexes.
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

// Applied before paint so the shell never flashes the wrong theme. Defaults to
// dark, matching the marketing site; "light" is the only override.
const themeScript = `(function () {
  try {
    var saved = localStorage.getItem('spindle-app-theme');
    document.documentElement.classList.toggle('dark', saved !== 'light');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();`

/**
 * Root layout for the authenticated area, gated two ways:
 *
 *  - Mock mode (`NEXT_PUBLIC_MOCK_AUTH=1`): visitors need a valid
 *    `spindle_mock_session` cookie; the decoded session seeds
 *    `MockSessionProvider` and everything behaves exactly as before.
 *  - Real mode: visitors need a session cookie (`spindle_rt` refresh token
 *    presence, or a signed `spindle_at` access token — expiry intentionally
 *    ignored here, since an expired token still proves a real session exists
 *    and the client provider can refresh it) to be considered
 *    maybe-authenticated. The tree renders with
 *    `MockSessionProvider` in adapter mode, which resolves the real session
 *    client-side and bounces to `/sign-in` when it comes back signed-out.
 *
 * Either way, visitors without the right cookies are sent to the sign-in
 * page. It deliberately
 * does not import `styles.css`, so none of the marketing chrome (header,
 * footer, cookie banner) can leak into the shell.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()

  let initialSession: MockSessionData | undefined
  if (mockAuthEnabled) {
    const session = decodeMockSession(cookieStore.get(MOCK_SESSION_COOKIE)?.value)
    if (!session) redirect(SIGN_IN_PATH)
    initialSession = session
  } else {
    // Best-effort gate: the refresh cookie is path-scoped to /api/auth so it
    // is usually absent here; a signed access token is the common signal.
    // Expiry is not enforced — a genuine but expired token still means the
    // visitor holds a real session, and AuthSessionProvider refreshes it via
    // /api/auth/session (which does receive the path-scoped refresh cookie).
    const accessToken = cookieStore.get(ACCESS_COOKIE)?.value
    const hasSignedAccess =
      typeof accessToken === "string" && verifyAuthTokenIgnoreExpiry(accessToken, "access") !== null
    const hasRefresh = cookieStore.get(REFRESH_COOKIE) !== undefined
    if (!hasRefresh && !hasSignedAccess) redirect(SIGN_IN_PATH)
  }

  // Seed the provider with the cookie locale so SSR and first client render
  // agree; LOCALE_BOOT_SCRIPT already fixed <html lang> pre-paint.
  const initialLocale = matchLocale(cookieStore.get(LOCALE_COOKIE)?.value) ?? undefined

  return (
    // The inline theme script below sets `class="dark"` before hydration, so the
    // server HTML never matches the client on purpose.
    <html lang={initialLocale ?? "en"} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Pre-paint theme/locale boot scripts — SSR-only (see component). */}
        <PrePaintScripts scripts={[themeScript, LOCALE_BOOT_SCRIPT]} />
      </head>
      <body className="app-body">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Providers>
          <LanguageProvider initialLocale={initialLocale}>
            <IconSprite />
            <MockSessionProvider initialSession={initialSession}>
              <AppNotificationsProvider>
                <UploadsProvider>
                  <AppShell>
                    {/* Inline at the top of <main> on every app page;
                        self-fetches and renders nothing when idle. */}
                    <AnnouncementBanner />
                    {children}
                  </AppShell>
                  <UploadQueueDock />
                </UploadsProvider>
              </AppNotificationsProvider>
            </MockSessionProvider>
          </LanguageProvider>
        </Providers>
        <ServiceWorkerRegistration />
        <InstallPrompt />
        <OfflineIndicator />
      </body>
    </html>
  )
}
