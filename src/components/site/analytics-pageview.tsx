"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

import { trackPageView } from "@/lib/analytics"

/**
 * Fires a `page_view` analytics event on every client-side navigation of the
 * marketing site. Mounted once in the site layout; `trackPageView` itself is
 * consent-gated, so this is inert until the visitor allows analytics.
 */
export function AnalyticsPageView() {
  const pathname = usePathname()

  useEffect(() => {
    trackPageView(pathname)
  }, [pathname])

  return null
}
