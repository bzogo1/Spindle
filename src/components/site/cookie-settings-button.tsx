"use client"

import { openCookieSettings } from "@/lib/consent"

/**
 * Opens the consent settings dialog from server-rendered chrome: the site
 * footer and the standalone changelog page. The dialog itself is mounted once
 * per layout by <CookieConsent />.
 */
export function CookieSettingsButton({
  className,
  label = "Cookie settings",
}: {
  className?: string
  label?: string
}) {
  return (
    <button type="button" className={className} onClick={openCookieSettings}>
      {label}
    </button>
  )
}
