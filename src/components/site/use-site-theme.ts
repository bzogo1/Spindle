"use client"

import { useCallback, useEffect, useState } from "react"

import {
  applySiteTheme,
  readSiteThemeMode,
  SITE_THEME_EVENT,
  SITE_THEME_MODES,
  siteThemeDark,
  type SiteThemeMode,
} from "@/components/site/site-theme"

const DARK_QUERY = "(prefers-color-scheme: dark)"

/**
 * Light/dark/system theme for the marketing site and auth screens. The
 * (site)/(auth) layouts apply the saved mode before paint via
 * SITE_THEME_SCRIPT; this hook tracks the mode so the header toggle and any
 * other control stay in sync. With no stored preference the mode resolves
 * to "dark" (the site's historical appearance); only an explicit "system"
 * choice follows OS changes via a matchMedia listener that keeps the
 * `.dark` class in sync.
 */
export function useSiteTheme() {
  // Fixed initial state (not readSiteThemeMode()) so the server-rendered
  // toggle matches the client's first render; the effect below syncs to the
  // real stored mode. "dark" matches the no-preference default applied by
  // SITE_THEME_SCRIPT before paint.
  const [mode, setMode] = useState<SiteThemeMode>("dark")
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const sync = () => {
      const next = readSiteThemeMode()
      setMode(next)
      setDark(siteThemeDark(next))
    }
    sync()

    const media = window.matchMedia(DARK_QUERY)
    const onMediaChange = () => {
      const next = readSiteThemeMode()
      const resolved = siteThemeDark(next)
      // While in system mode the OS is the source of truth, so the class
      // follows it live; explicit light/dark ignores OS changes.
      if (next === "system") {
        document.documentElement.classList.toggle("dark", resolved)
      }
      setMode(next)
      setDark(resolved)
    }
    media.addEventListener("change", onMediaChange)

    window.addEventListener(SITE_THEME_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      media.removeEventListener("change", onMediaChange)
      window.removeEventListener(SITE_THEME_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const set = useCallback((next: SiteThemeMode) => {
    applySiteTheme(next)
    setMode(next)
    setDark(siteThemeDark(next))
  }, [])

  /** Cycle light → dark → system → light. */
  const cycle = useCallback(() => {
    set(
      SITE_THEME_MODES[
        (SITE_THEME_MODES.indexOf(readSiteThemeMode()) + 1) % SITE_THEME_MODES.length
      ],
    )
  }, [set])

  return { mode, dark, set, cycle }
}
