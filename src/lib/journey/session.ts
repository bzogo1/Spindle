/**
 * Journey-session identifier.
 *
 * One id per browser tab session stitches together every `journey_step` event
 * a user emits while working through a flow — including across client-side
 * navigations and reloads (sessionStorage survives reloads, dies with the
 * tab). It complements the stitching keys already attached by
 * `src/lib/analytics.ts`:
 *
 * - `anonymousId` — per-tab random id on every analytics event (no storage).
 * - `userId` — session principal (`user:<uid>` / `mock:<email>`) stamped
 *   server-side by `/api/analytics` once the visitor is signed in.
 *
 * Together they let analysis reconstruct a journey even when the visitor
 * signs up mid-flow: anonymous events carry `anonymousId` + `journeySessionId`,
 * post-auth events additionally carry `userId`.
 *
 * No cookies, no persistence beyond the tab — stays inside the "essential"
 * consent category like sessionStorage theme prefs.
 */

const JOURNEY_SESSION_KEY = "spindle.journey.session"

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined"
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    // fall through to the non-crypto id
  }
  return `js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Returns the current journey-session id, creating and persisting one on
 * first use. Returns `null` outside the browser or when storage is
 * unavailable (private mode) — callers must treat the id as optional.
 */
export function getJourneySessionId(): string | null {
  if (!isBrowser()) return null
  try {
    const existing = window.sessionStorage.getItem(JOURNEY_SESSION_KEY)
    if (existing) return existing
    const id = randomId()
    window.sessionStorage.setItem(JOURNEY_SESSION_KEY, id)
    return id
  } catch {
    return null
  }
}

/** Test hook / explicit reset: drops the stored id; next call mints a new one. */
export function resetJourneySession(): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.removeItem(JOURNEY_SESSION_KEY)
  } catch {
    // Storage unavailable — nothing to reset.
  }
}
