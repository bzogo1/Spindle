"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

import { findNavLabel } from "./nav-items"

/**
 * localStorage key holding the recently visited app routes, most recent
 * first. Stored as bare href strings; labels are resolved at render time via
 * {@link findNavLabel} so renames stay fresh.
 */
export const RECENT_PAGES_STORAGE_KEY = "spindle.recent-pages"

/** How many recently visited pages the sidebar keeps. */
export const MAX_RECENT_PAGES = 5

export type RecentPage = {
  href: string
  label: string
}

export function readRecentPageHrefs(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(RECENT_PAGES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === "string")
  } catch {
    return []
  }
}

function writeRecentPageHrefs(hrefs: string[]) {
  try {
    window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify(hrefs))
  } catch {
    // Storage can be unavailable (private mode, quota); recents are a
    // convenience feature, so failing silently is fine.
  }
}

/** Fallback label for routes that are not part of the nav structure. */
function fallbackLabel(pathname: string): string {
  if (pathname === "/") return "Home"
  if (pathname.startsWith("/projects/")) return "Project"
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? pathname
  const words = segment.replace(/[-_]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function labelFor(href: string): string {
  return findNavLabel(href) ?? fallbackLabel(href)
}

/**
 * Tracks route changes via {@link usePathname} and persists the last
 * {@link MAX_RECENT_PAGES} visited hrefs in localStorage. Returns the stored
 * pages (most recent first) with labels resolved, excluding the current page.
 */
export function useRecentPages(): RecentPage[] {
  const pathname = usePathname()
  const [hrefs, setHrefs] = useState<string[]>([])

  useEffect(() => {
    const next = [pathname, ...readRecentPageHrefs().filter((href) => href !== pathname)].slice(
      0,
      MAX_RECENT_PAGES,
    )
    writeRecentPageHrefs(next)
    setHrefs(next)
  }, [pathname])

  return hrefs
    .filter((href) => href !== pathname)
    .slice(0, MAX_RECENT_PAGES)
    .map((href) => ({ href, label: labelFor(href) }))
}
