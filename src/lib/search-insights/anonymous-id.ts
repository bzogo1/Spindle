const ANON_ID_KEY = "spindle-search-insights-anon-id"

/**
 * Anonymous visitor id for search analytics and experiment bucketing.
 * Persisted in localStorage; generated once per browser profile. Not a
 * tracking identifier beyond this origin — it never leaves the device
 * (analytics are stored locally, per product decision).
 */
export function getAnonymousId(): string {
  if (typeof window === "undefined") return "ssr"
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY)
    if (existing) return existing
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(ANON_ID_KEY, id)
    return id
  } catch {
    // Storage unavailable (private mode): fall back to a per-call id so
    // callers still get a stable-ish string for the session.
    return `anon-ephemeral-${Math.random().toString(36).slice(2, 10)}`
  }
}

/** Test hook: reset the stored anonymous id. */
export function resetAnonymousIdForTests() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(ANON_ID_KEY)
  } catch {
    // ignore
  }
}
