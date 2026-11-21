/* ==========================================================================
   Recently viewed features — localStorage-backed recents
   ========================================================================== */

const STORAGE_KEY = "spindle:recently-viewed-features"
export const RECENTLY_VIEWED_LIMIT = 6

function readSlugs(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

/** Record a feature slug as viewed; most recent first, deduped, capped. */
export function recordFeatureView(slug: string): void {
  if (typeof window === "undefined" || !slug) return
  try {
    const next = [slug, ...readSlugs().filter((item) => item !== slug)].slice(
      0,
      RECENTLY_VIEWED_LIMIT,
    )
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage may be unavailable (private mode, quota); recents are best-effort.
  }
}

/** Slugs of recently viewed features, most recent first. */
export function getRecentlyViewedSlugs(): string[] {
  return readSlugs().slice(0, RECENTLY_VIEWED_LIMIT)
}
