import type { Metadata, Viewport } from "next"

import "@/app/styles/index.css"
import "@/app/styles/ui.css"
import "@/app/styles/styles.css"
import "@/app/styles/auth.css"

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
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0f0e",
}

/** Minimal root layout for account recovery: brand mark only, no site chrome. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
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
      <body className="auth-body">
        <div className="auth-glow" aria-hidden="true" />
        {children}
      </body>
    </html>
  )
}
