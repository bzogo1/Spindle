/**
 * Subsequence fuzzy matching for the command-menu search index.
 *
 * Scores are "lower is better": a direct substring hit beats a scattered
 * subsequence match, and contiguous or word-boundary hits beat mid-word ones.
 * Pure functions — safe to unit test and to run on the main thread per query.
 */

/**
 * Score a single text field against the query. Returns null when the query is
 * not a subsequence of the text. An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyScoreNormalized(query.toLowerCase(), text.toLowerCase())
}

/**
 * `fuzzyScore` for callers that already hold lowercase strings — the prepared
 * search index (./index-build) lowercases fields once at build time so each
 * query skips per-field `toLowerCase` allocations.
 */
export function fuzzyScoreNormalized(q: string, t: string): number | null {
  if (!q) return 0

  const substring = t.indexOf(q)
  if (substring !== -1) {
    const boundary = substring === 0 || /[\s\-_./]/.test(t[substring - 1]) ? 0 : 50
    return substring * 10 + boundary
  }

  let qi = 0
  let score = 0
  let lastMatch = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] !== q[qi]) continue
    const gap = lastMatch === -1 ? ti : ti - lastMatch - 1
    score += gap * 3 + ti * 0.1
    if (ti === 0 || /[\s\-_./]/.test(t[ti - 1])) score -= 8
    lastMatch = ti
    qi += 1
  }
  return qi === q.length ? 1000 + score : null
}

/**
 * Field weights: a title hit always outranks the same hit in a subtitle or keywords.
 * `RankingConfig` (./ranking) can override these per call; these constants are
 * the defaults used when no ranking config is supplied.
 */
export const FIELD_PENALTIES = {
  title: 0,
  subtitle: 20,
  keywords: 50,
} as const

export type SearchFields = {
  title: string
  subtitle?: string
  keywords?: string
}

/** Per-field additive penalties; lower values rank better. */
export type FieldPenalties = {
  title?: number
  subtitle?: number
  keywords?: number
}

/**
 * Field-weighted fuzzy score for one search item: the best (lowest) of the
 * per-field scores after applying each field's penalty. Returns null when no
 * field matches.
 *
 * `penalties` optionally overrides `FIELD_PENALTIES` — the ranking config in
 * ./ranking passes its own weights through here so ordering can be tuned
 * without touching this module.
 */
export function scoreSearchFields(
  query: string,
  fields: SearchFields,
  penalties: FieldPenalties = FIELD_PENALTIES,
): number | null {
  const candidates = [addPenalty(fuzzyScore(query, fields.title), penalties.title)]

  if (fields.subtitle) {
    const subtitle = fuzzyScore(query, fields.subtitle)
    if (subtitle !== null) candidates.push(addPenalty(subtitle, penalties.subtitle))
  }
  if (fields.keywords) {
    const keywords = fuzzyScore(query, fields.keywords)
    if (keywords !== null) candidates.push(addPenalty(keywords, penalties.keywords))
  }

  const scores = candidates.filter((score): score is number => score !== null)
  return scores.length > 0 ? Math.min(...scores) : null
}

/**
 * `scoreSearchFields` for pre-lowercased input: `query`, `title`,
 * `subtitle`, and `keywords` must already be lowercase. Used by the prepared
 * index path in ./index.
 */
export function scoreSearchFieldsNormalized(
  query: string,
  fields: { title: string; subtitle?: string; keywords?: string },
  penalties: FieldPenalties = FIELD_PENALTIES,
): number | null {
  const candidates = [addPenalty(fuzzyScoreNormalized(query, fields.title), penalties.title)]

  if (fields.subtitle) {
    const subtitle = fuzzyScoreNormalized(query, fields.subtitle)
    if (subtitle !== null) candidates.push(addPenalty(subtitle, penalties.subtitle))
  }
  if (fields.keywords) {
    const keywords = fuzzyScoreNormalized(query, fields.keywords)
    if (keywords !== null) candidates.push(addPenalty(keywords, penalties.keywords))
  }

  const scores = candidates.filter((score): score is number => score !== null)
  return scores.length > 0 ? Math.min(...scores) : null
}

function addPenalty(score: number | null, penalty: number | undefined): number | null {
  if (score === null) return null
  return score + (penalty ?? 0)
}

/* ------------------------------------------------------------------------ */
/* Spelling correction (edit distance)                                      */
/* ------------------------------------------------------------------------ */

/**
 * Levenshtein edit distance between two strings, computed with a single
 * rolling row. Bounded by `maxDistance`: as soon as every cell in the row
 * exceeds the bound the function returns `maxDistance + 1` early, which keeps
 * "did you mean" checks cheap on long candidate lists.
 */
export function editDistance(a: string, b: string, maxDistance = Infinity): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Ensure `a` is the shorter string to keep the row small.
  if (a.length > b.length) [a, b] = [b, a]

  const bound = Math.min(maxDistance, Math.max(a.length, b.length))
  let previous = new Array<number>(a.length + 1)
  let current = new Array<number>(a.length + 1)
  for (let i = 0; i <= a.length; i += 1) previous[i] = i

  for (let j = 1; j <= b.length; j += 1) {
    current[0] = j
    let rowMin = current[0]
    for (let i = 1; i <= a.length; i += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[i]! + 1, current[i - 1]! + 1, previous[i - 1]! + cost)
      current[i] = value
      if (value < rowMin) rowMin = value
    }
    // Each remaining column can lower the eventual distance by at most 1,
    // so if even the best possible continuation exceeds the bound we can
    // stop early.
    if (rowMin - (b.length - j) > bound) return bound + 1
    ;[previous, current] = [current, previous]
  }

  return previous[a.length]!
}

export type SpellingSuggestion = {
  /** The corrected term, in the candidate's original casing. */
  suggestion: string
  /** Normalized similarity in (0, 1]; 1 means identical. */
  confidence: number
  /** Raw edit distance between query and suggestion. */
  distance: number
}

export type SpellingOptions = {
  /**
   * Maximum edit distance considered. Defaults to a length-scaled bound:
   * short queries tolerate 1 edit, longer ones up to 3.
   */
  maxDistance?: number
  /**
   * Minimum confidence (`1 - distance / max(len)`) for a suggestion to be
   * returned. Defaults to 0.5.
   */
  minConfidence?: number
  /** Cap on returned suggestions. Defaults to 3. */
  limit?: number
}

function defaultMaxDistance(queryLength: number): number {
  if (queryLength <= 4) return 1
  if (queryLength <= 8) return 2
  return 3
}

/**
 * "Did you mean" suggestions for a misspelled query, ranked by confidence.
 *
 * Candidates are matched case-insensitively; the returned suggestion keeps
 * the candidate's original casing. Exact matches and candidates shorter than
 * 3 characters are skipped — a 1–2 letter query is too ambiguous to correct.
 */
export function suggestSpellingCorrections(
  query: string,
  candidates: Iterable<string>,
  options: SpellingOptions = {},
): SpellingSuggestion[] {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return []

  const maxDistance = options.maxDistance ?? defaultMaxDistance(q.length)
  const minConfidence = options.minConfidence ?? 0.5
  const limit = options.limit ?? 3
  if (limit <= 0) return []

  const seen = new Set<string>()
  const results: SpellingSuggestion[] = []

  for (const raw of candidates) {
    const candidate = raw.trim()
    if (!candidate || candidate.length < 3) continue
    const key = candidate.toLowerCase()
    if (key === q || seen.has(key)) continue
    seen.add(key)

    const distance = editDistance(q, key, maxDistance)
    if (distance > maxDistance || distance === 0) continue

    const confidence = 1 - distance / Math.max(q.length, key.length)
    if (confidence < minConfidence) continue

    results.push({ suggestion: candidate, confidence, distance })
  }

  return results
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        a.distance - b.distance ||
        a.suggestion.localeCompare(b.suggestion),
    )
    .slice(0, limit)
}
