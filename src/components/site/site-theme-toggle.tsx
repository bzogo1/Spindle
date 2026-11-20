"use client"

import { Monitor, Moon, Sun } from "lucide-react"

import { useSiteTheme } from "@/components/site/use-site-theme"
import type { SiteThemeMode } from "@/components/site/site-theme"

const MODE_LABEL: Record<SiteThemeMode, string> = {
  light: "light",
  dark: "dark",
  system: "system",
}

const NEXT_LABEL: Record<SiteThemeMode, SiteThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
}

function ModeIcon({ mode }: { mode: SiteThemeMode }) {
  if (mode === "dark") return <Moon aria-hidden="true" />
  if (mode === "system") return <Monitor aria-hidden="true" />
  return <Sun aria-hidden="true" />
}

/**
 * Site header theme control. Cycles light → dark → system; the icon shows the
 * current mode and the accessible name announces the next one.
 */
export function SiteThemeToggle() {
  const { mode, cycle } = useSiteTheme()

  return (
    <button
      type="button"
      className="site-theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${MODE_LABEL[mode]} — switch to ${MODE_LABEL[NEXT_LABEL[mode]]}`}
    >
      <ModeIcon mode={mode} />
    </button>
  )
}
