import type { Metadata, Viewport } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import "@/app/styles/index.css"
import "@/app/styles/ui.css"
import "@/app/styles/app.css"

import { AppShell } from "@/components/app/app-shell"
import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { IconSprite } from "@/components/site/icon-sprite"
import { Providers } from "@/components/site/providers"
import {
  decodeMockSession,
  MOCK_SESSION_COOKIE,
  mockAuthEnabled,
  SIGN_IN_PATH,
} from "@/lib/auth/mock-session"

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
 * Root layout for the authenticated area. The whole group is gated on
 * NEXT_PUBLIC_MOCK_AUTH=1: without the flag every app route 404s, and with it
 * visitors need a valid mock-session cookie or they are sent back to the
 * marketing site with the auth dialog open (`?signin=1`). It deliberately does
 * not import `styles.css`, so none of the marketing chrome (header, footer,
 * cookie banner) can leak into the shell.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!mockAuthEnabled) notFound()

  const cookieStore = await cookies()
  const session = decodeMockSession(cookieStore.get(MOCK_SESSION_COOKIE)?.value)
  if (!session) redirect(SIGN_IN_PATH)

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="app-body">
        <Providers>
          <IconSprite />
          <MockSessionProvider initialSession={session}>
            <AppShell>{children}</AppShell>
          </MockSessionProvider>
        </Providers>
      </body>
    </html>
  )
}
