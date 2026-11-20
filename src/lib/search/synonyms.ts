/**
 * Synonym dictionary applied at query time.
 *
 * `expandQuery` turns a raw query into a small set of query *variants*: the
 * original plus one variant per synonym substitution (one token at a time, so
 * the variant count stays linear in the number of synonym hits rather than
 * exploding combinatorially). `SearchIndex` scores an item against every
 * variant and keeps the best score, so "api" also finds "endpoint" results
 * without polluting the index itself.
 *
 * The dictionary is a plain `Record<string, string[]>`; callers can pass a
 * custom dictionary or extend the default with `withSynonyms`.
 */

export type SynonymDictionary = Record<string, readonly string[]>

/**
 * Built-in synonyms for the Spindle corpus. Keys and values are lowercase;
 * matching is case-insensitive. Keep entries short — every synonym adds one
 * query variant per occurrence.
 */
export const DEFAULT_SYNONYMS: SynonymDictionary = {
  api: ["endpoint", "rest", "interface"],
  auth: ["authentication", "login", "sign-in"],
  billing: ["payment", "invoice", "subscription"],
  config: ["configuration", "settings", "preferences"],
  deploy: ["deployment", "hosting", "publish"],
  doc: ["docs", "documentation", "guide", "manual"],
  file: ["files", "document", "attachment"],
  invite: ["invitation", "member", "teammate"],
  lab: ["notebook", "jupyter", "rstudio"],
  member: ["teammate", "user", "collaborator"],
  notif: ["notification", "alert", "reminder"],
  project: ["workspace", "repo", "repository"],
  search: ["find", "lookup", "query"],
  secret: ["credential", "token", "key"],
  team: ["workspace", "members", "group"],
  theme: ["appearance", "dark", "light"],
  workflow: ["automation", "pipeline", "cron"],
}

/** Upper bound on variants produced for a single query. */
export const MAX_QUERY_VARIANTS = 12

function normalizeToken(token: string): string {
  return token.toLowerCase()
}

/** Look up synonyms for one whitespace-separated token. */
export function synonymsFor(token: string, dict: SynonymDictionary = DEFAULT_SYNONYMS): string[] {
  return [...(dict[normalizeToken(token)] ?? [])]
}

/**
 * Return query variants with synonym substitutions applied. The first entry
 * is always the trimmed original query. Each subsequent variant replaces a
 * single query token with one of its synonyms, preserving the other tokens.
 * Variants are deduplicated and capped at `MAX_QUERY_VARIANTS`.
 */
export function expandQuery(query: string, dict: SynonymDictionary = DEFAULT_SYNONYMS): string[] {
  const original = query.trim()
  if (!original) return original ? [original] : []

  const tokens = original.split(/\s+/)
  const variants: string[] = [original]
  const seen = new Set<string>([original.toLowerCase()])

  for (let i = 0; i < tokens.length && variants.length < MAX_QUERY_VARIANTS; i += 1) {
    for (const synonym of synonymsFor(tokens[i]!, dict)) {
      if (variants.length >= MAX_QUERY_VARIANTS) break
      const replaced = [...tokens]
      replaced[i] = synonym
      const variant = replaced.join(" ")
      const key = variant.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      variants.push(variant)
    }
  }

  return variants
}

/**
 * Return a new dictionary with `extra` entries merged in (extra synonyms are
 * appended to existing keys). Useful for domain-specific vocabularies.
 */
export function withSynonyms(base: SynonymDictionary, extra: SynonymDictionary): SynonymDictionary {
  const merged: SynonymDictionary = { ...base }
  for (const [key, values] of Object.entries(extra)) {
    const normalized = key.toLowerCase()
    merged[normalized] = [
      ...new Set([...(merged[normalized] ?? []), ...values.map((v) => v.toLowerCase())]),
    ]
  }
  return merged
}
