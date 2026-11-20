import type { SearchItem } from "./index"
import { suggestSpellingCorrections, type SpellingSuggestion } from "./fuzzy"
import { DEFAULT_SYNONYMS, synonymsFor } from "./synonyms"

/**
 * Query-time suggestions: "did you mean" spelling corrections, related
 * queries, and trending queries.
 *
 * Trending/related queries are derived from a small local event log in
 * localStorage (`recordSearchQuery`) — no identifiers, no network. When the
 * log is empty, trending falls back to recency-weighted item titles so the
 * UI still has something useful to show.
 */

export const QUERY_LOG_STORAGE_KEY = "spindle-search-query-log"
/** Entries kept in the local query log. */
const MAX_LOG_ENTRIES = 200
/** Trending window: queries used within this span count fully. */
const TRENDING_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
/** Cap on candidate phrases fed to the spelling corrector. */
const MAX_SPELLING_CANDIDATES = 400

export type QueryLogEntry = {
  query: string
  count: number
  lastUsed: number
}

export type SearchSuggestions = {
  /** Spelling corrections for the current query ("did you mean"). */
  didYouMean: SpellingSuggestion[]
  /** Related queries: logged queries and item titles sharing tokens. */
  related: string[]
  /** Trending queries from the local log (or item-derived fallback). */
  trending: string[]
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function isLogEntry(value: unknown): value is QueryLogEntry {
  if (typeof value !== "object" || value === null) return false
  const entry = value as QueryLogEntry
  return (
    typeof entry.query === "string" &&
    typeof entry.count === "number" &&
    typeof entry.lastUsed === "number"
  )
}

/** Read the query log, most relevant first. */
export function readQueryLog(now: number = Date.now()): QueryLogEntry[] {
  const store = storage()
  if (!store) return []

  let parsed: unknown
  try {
    const raw = store.getItem(QUERY_LOG_STORAGE_KEY)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    return []
  }

  const entries: QueryLogEntry[] = []
  if (Array.isArray(parsed)) {
    for (const value of parsed) {
      if (isLogEntry(value)) entries.push(value)
    }
  } else if (typeof parsed === "object" && parsed !== null) {
    // Tolerate the object shape `{ query: entry }` too.
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (isLogEntry(value)) entries.push(value)
    }
  }
  return entries.sort((a, b) => queryLogScore(b, now) - queryLogScore(a, now))
}

function queryLogScore(entry: QueryLogEntry, now: number): number {
  const frequency = Math.min(entry.count, 10) / 10
  const age = Math.max(0, now - entry.lastUsed)
  const recency = Math.exp((-age / TRENDING_HALF_LIFE_MS) * Math.LN2)
  return frequency * 0.5 + recency * 0.5
}

function writeQueryLog(entries: QueryLogEntry[]) {
  const store = storage()
  if (!store) return
  const kept = [...entries].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_LOG_ENTRIES)
  try {
    store.setItem(QUERY_LOG_STORAGE_KEY, JSON.stringify(kept))
  } catch {
    // Storage unavailable — suggestions degrade to static behavior.
  }
}

/** Record a submitted/executed query for trending + related suggestions. */
export function recordSearchQuery(query: string, now: number = Date.now()) {
  const q = query.trim()
  if (q.length < 2) return
  const log = readQueryLog(now)
  const existing = log.find((entry) => entry.query.toLowerCase() === q.toLowerCase())
  if (existing) {
    existing.count += 1
    existing.lastUsed = now
    existing.query = q
  } else {
    log.push({ query: q, count: 1, lastUsed: now })
  }
  writeQueryLog(log)
}

/** Clear the local query log (privacy control). */
export function clearQueryLog() {
  const store = storage()
  try {
    store?.removeItem(QUERY_LOG_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Trending queries: logged queries ranked by frequency + recency. When the
 * log has fewer than `limit` entries, item titles are appended as a static
 * fallback so the suggestion UI is never empty.
 */
export function trendingQueries(
  limit = 5,
  now: number = Date.now(),
  items: SearchItem[] = [],
): string[] {
  const fromLog = readQueryLog(now)
    .slice(0, limit)
    .map((entry) => entry.query)

  if (fromLog.length >= limit) return fromLog.slice(0, limit)

  const fallback = items
    .map((item) => item.title)
    .filter((title) => title && !fromLog.some((q) => q.toLowerCase() === title.toLowerCase()))
    .slice(0, limit - fromLog.length)

  return [...fromLog, ...fallback]
}

function queryTokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9+#.-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  )
}

/**
 * Related queries for `query`: logged queries and item titles/subtitles that
 * share at least one significant token, ranked by shared-token count then by
 * log score. Synonyms count as shared tokens so "api" relates to "endpoint".
 */
export function relatedQueries(
  query: string,
  options: { items?: SearchItem[]; limit?: number; now?: number } = {},
): string[] {
  const q = query.trim()
  if (!q) return []
  const { items = [], limit = 5, now = Date.now() } = options

  const tokens = queryTokens(q)
  // Expand tokens with synonyms so related matches cross vocabulary.
  for (const token of [...tokens]) {
    for (const synonym of synonymsFor(token, DEFAULT_SYNONYMS)) {
      tokens.add(synonym.toLowerCase())
    }
  }
  if (tokens.size === 0) return []

  const candidates = new Map<string, { text: string; score: number }>()

  const consider = (text: string, baseScore: number) => {
    const candidate = text.trim()
    if (!candidate || candidate.toLowerCase() === q.toLowerCase()) return
    const candidateTokens = queryTokens(candidate)
    let overlap = 0
    for (const token of candidateTokens) {
      if (tokens.has(token)) overlap += 1
    }
    if (overlap === 0) return
    const key = candidate.toLowerCase()
    const score = overlap * 10 + baseScore
    const existing = candidates.get(key)
    if (!existing || score > existing.score) {
      candidates.set(key, { text: candidate, score })
    }
  }

  for (const entry of readQueryLog(now)) {
    consider(entry.query, queryLogScore(entry, now))
  }
  for (const item of items) {
    consider(item.title, 1)
    if (item.subtitle) consider(item.subtitle, 0.5)
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, limit)
    .map((entry) => entry.text)
}

/**
 * Candidate phrases for spelling correction: item titles first (they are the
 * vocabulary users actually see), then logged queries. Deduplicated and
 * capped so the O(candidates × query) edit-distance pass stays cheap.
 */
export function spellingCandidates(items: SearchItem[] = [], now: number = Date.now()): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  const push = (text: string | undefined) => {
    const value = text?.trim()
    if (!value) return
    const key = value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(value)
    if (candidates.length >= MAX_SPELLING_CANDIDATES) return
  }
  for (const item of items) push(item.title)
  for (const entry of readQueryLog(now)) push(entry.query)
  return candidates
}

/**
 * Full suggestion bundle for a query. `didYouMean` is only populated for
 * non-empty queries with no exact candidate match; `related` and `trending`
 * are always computed (trending falls back to item titles when the log is
 * empty).
 */
export function searchSuggestions(
  query: string,
  options: { items?: SearchItem[]; limit?: number; now?: number } = {},
): SearchSuggestions {
  const { items = [], limit = 5, now = Date.now() } = options
  const q = query.trim()

  const didYouMean =
    q.length >= 3 ? suggestSpellingCorrections(q, spellingCandidates(items, now), { limit: 3 }) : []
  const related = q ? relatedQueries(q, { items, limit, now }) : []
  // Trending always falls back to item titles when the local log is sparse.
  const trending = trendingQueries(limit, now, items)

  return { didYouMean, related, trending }
}
