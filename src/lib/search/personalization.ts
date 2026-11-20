/**
 * Search personalization (task: behavior-based ranking boost).
 *
 * Tracks two signals per item id in localStorage — privacy-safe by design:
 * no user identifiers, no fingerprints, no network calls; the data never
 * leaves the browser and can be wiped with `clearPersonalization`.
 *
 * - **Clicks** (`recordSearchClick`): how often and how recently the user
 *   activated a result.
 * - **Views** (`recordSearchView`): impressions — an item the user keeps
 *   seeing but never clicks gets only a small boost.
 *
 * `personalizationScore(id, now)` returns a value in `[0, 1]` consumed by the
 * ranking config (`personalizationBoost` in ./ranking) as a score subtraction,
 * so frequently-clicked and recently-viewed items rise without ever
 * overwhelming the text-match score.
 */

export const PERSONALIZATION_STORAGE_KEY = "spindle-search-personalization"
/** Entries kept on disk; oldest lastUsed entries are evicted first. */
const MAX_ENTRIES = 200
/** Click frequency saturates at this many clicks. */
const MAX_CLICKS = 10
/** View frequency saturates at this many impressions. */
const MAX_VIEWS = 20
/** Click recency half-life: a click two weeks old counts half. */
const CLICK_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
/** View recency half-life: impressions fade after a few days. */
const VIEW_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000

export type PersonalizationEntry = {
  /** Times the item was clicked/activated from search results. */
  clicks: number
  /** Epoch ms of the last click. */
  lastClick: number
  /** Times the item was rendered as a search result (impression). */
  views: number
  /** Epoch ms of the last impression. */
  lastView: number
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function isEntry(value: unknown): value is PersonalizationEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as PersonalizationEntry
  return (
    typeof entry.clicks === "number" &&
    typeof entry.lastClick === "number" &&
    typeof entry.views === "number" &&
    typeof entry.lastView === "number"
  )
}

/** Read the full personalization map (id → entry). */
export function readPersonalizationMap(
  _now: number = Date.now(),
): Map<string, PersonalizationEntry> {
  const map = new Map<string, PersonalizationEntry>()
  const store = storage()
  if (!store) return map

  let parsed: unknown
  try {
    const raw = store.getItem(PERSONALIZATION_STORAGE_KEY)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    return map
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(entry)) map.set(id, entry)
    }
  }
  return map
}

function writePersonalizationMap(map: Map<string, PersonalizationEntry>) {
  const store = storage()
  if (!store) return
  const entries = [...map.entries()]
    .sort(
      (a, b) => Math.max(b[1].lastClick, b[1].lastView) - Math.max(a[1].lastClick, a[1].lastView),
    )
    .slice(0, MAX_ENTRIES)
  try {
    store.setItem(PERSONALIZATION_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // Storage unavailable (private mode) — personalization just won't persist.
  }
}

function touch(id: string, field: "click" | "view", now: number): PersonalizationEntry | null {
  const map = readPersonalizationMap(now)
  const existing = map.get(id)
  const entry: PersonalizationEntry = existing ?? { clicks: 0, lastClick: 0, views: 0, lastView: 0 }
  if (field === "click") {
    entry.clicks += 1
    entry.lastClick = now
  } else {
    entry.views += 1
    entry.lastView = now
  }
  map.set(id, entry)
  writePersonalizationMap(map)
  return entry
}

/** Record that `id` was clicked/activated from a search result. */
export function recordSearchClick(id: string, now: number = Date.now()) {
  touch(id, "click", now)
}

/** Record an impression of `id` in the rendered result list. */
export function recordSearchView(id: string, now: number = Date.now()) {
  touch(id, "view", now)
}

/** Wipe all personalization data (privacy control). */
export function clearPersonalization() {
  const store = storage()
  try {
    store?.removeItem(PERSONALIZATION_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function decay(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1
  return Math.exp((-ageMs / halfLifeMs) * Math.LN2)
}

/**
 * Personalization score in `[0, 1]` for one entry at time `now`.
 * Clicks dominate (frequency + recency); views add a smaller signal.
 */
export function personalizationScoreFromEntry(
  entry: PersonalizationEntry | undefined,
  now: number,
): number {
  if (!entry) return 0

  const clickFrequency = Math.min(entry.clicks, MAX_CLICKS) / MAX_CLICKS
  const clickRecency = decay(now - entry.lastClick, CLICK_HALF_LIFE_MS)
  const viewFrequency = Math.min(entry.views, MAX_VIEWS) / MAX_VIEWS
  const viewRecency = decay(now - entry.lastView, VIEW_HALF_LIFE_MS)

  // Weight clicks 3× views; an item seen often but never clicked stays low.
  const clickPart = entry.clicks > 0 ? 0.5 * clickFrequency + 0.5 * clickRecency : 0
  const viewPart = entry.views > 0 ? 0.5 * viewFrequency + 0.5 * viewRecency : 0

  return Math.min(1, clickPart * 0.75 + viewPart * 0.25)
}

/** Convenience wrapper: personalization score for `id` at time `now`. */
export function personalizationScore(id: string, now: number = Date.now()): number {
  return personalizationScoreFromEntry(readPersonalizationMap(now).get(id), now)
}
