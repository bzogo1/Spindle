import type { ReactNode } from "react"

import { scoreSearchFields, scoreSearchFieldsNormalized, type FieldPenalties } from "./fuzzy"
import { readRecencyMap, frecencyFromMap } from "./recency"
import { DEFAULT_SYNONYMS, expandQuery, type SynonymDictionary } from "./synonyms"
import { resolveRanking, type RankingConfig } from "./ranking"
import { applySearchFilters, type SearchFilters } from "./filters"
import { personalizationScoreFromEntry, readPersonalizationMap } from "./personalization"
import {
  prepareItems,
  prepareItemsIncremental,
  timeSearch,
  type PreparedItem,
  type TimingSink,
} from "./index-build"

/**
 * Pluggable search index for the ⌘K command menu.
 *
 * Each domain (pages, projects, files, docs, changelog, actions) registers a
 * `SearchIndexProvider` whose `load()` returns `SearchItem`s. Providers load
 * lazily — on first menu open or during idle time — and their results are
 * cached by `cacheKey`, so a provider only refetches when its key changes.
 *
 * Scoring pipeline (per query):
 *   1. optional synonym expansion (`expandQuery`) → up to N query variants,
 *   2. field-weighted fuzzy score per variant (title > subtitle > keywords,
 *      weights from `RankingConfig`),
 *   3. boosts subtracted: frecency (`recencyBoost`) + personalization
 *      (`personalizationBoost`, from click/view tracking in localStorage),
 *   4. optional `SearchFilters` (type / section / tag / last-updated),
 *   5. sort by score, ties broken alphabetically by title.
 *
 * `SearchIndex.version` increments every time the item set is (re)loaded —
 * result caches key on it so stale entries invalidate automatically.
 */

export type SearchItem = {
  /** Stable id, also used for recency tracking (e.g. "project:prj_01"). */
  id: string
  title: string
  subtitle?: string
  keywords?: string
  /** Display group label, e.g. "Projects". */
  group: string
  icon?: ReactNode
  /** Client-side route to navigate to. Mutually exclusive with `action`. */
  href?: string
  /** Named action dispatched by the UI layer when there is no href. */
  action?: string
  /** Extra action parameters, e.g. `{ slug }` for workspace switching. */
  meta?: Record<string, string>
  /**
   * Result kind for filtering/faceting ("page", "doc", "api", "project",
   * "file", "changelog", "action", …). When absent it is derived from the
   * id prefix or the group label — see `searchItemType` in ./filters.
   */
  type?: string
  /** Section/category within the type, e.g. a docs guide title. Defaults to `group`. */
  section?: string
  /** Free-form tags for faceting and tag filters. */
  tags?: string[]
  /** Last-updated time: epoch ms/seconds or an ISO date string. */
  updatedAt?: number | string
}

export type SearchIndexProvider = {
  /** Unique provider id (also the React key for its item group). */
  id: string
  /** Display label for the group this provider feeds. */
  group: string
  /**
   * Cache invalidation key. Defaults to `id`; change it (e.g. embed the
   * workspace list) to force the provider to reload its items.
   */
  cacheKey?: string
  load: () => Promise<SearchItem[]> | SearchItem[]
}

export type SearchHit = {
  item: SearchItem
  /** Adjusted score, lower is better. Includes recency + personalization boosts. */
  score: number
}

/** Per-call search options. */
export type SearchOptions = {
  /** Result filters (type / section / tag / updated range). */
  filters?: SearchFilters
  /** Ranking weight overrides merged over the index defaults. */
  ranking?: Partial<RankingConfig>
}

export type SearchIndexOptions = {
  /** Default ranking weights; per-call `SearchOptions.ranking` overrides. */
  ranking?: Partial<RankingConfig>
  /**
   * Synonym dictionary for query expansion, or `false` to disable. Defaults
   * to `DEFAULT_SYNONYMS` (expansion on).
   */
  synonyms?: SynonymDictionary | false
  /** Instrumentation hook fired after every `search()` call. */
  onSearchTiming?: TimingSink
}

let instanceCounter = 0

export class SearchIndex {
  private providers: SearchIndexProvider[] = []
  /** cacheKey → in-flight/resolved provider promise. */
  private entries = new Map<string, Promise<SearchItem[]>>()
  /** providerId → items it last contributed; `items` is their flattening. */
  private contributions = new Map<string, SearchItem[]>()
  private items: SearchItem[] = []
  private loadPromise: Promise<void> | null = null
  private loaded = false
  /** Bumped on every completed (re)load — the cache-invalidation signal. */
  private versionCounter = 0
  /** Unique per instance so result caches never collide across indexes. */
  readonly instanceId = ++instanceCounter
  private prepared: PreparedItem[] | null = null
  private preparedVersion = -1
  private readonly defaultRanking: RankingConfig
  private readonly synonyms: SynonymDictionary | false
  private readonly onSearchTiming?: TimingSink

  constructor(providers: SearchIndexProvider[] = [], options: SearchIndexOptions = {}) {
    this.providers = providers
    this.defaultRanking = resolveRanking(options.ranking)
    this.synonyms = options.synonyms === undefined ? DEFAULT_SYNONYMS : options.synonyms
    this.onSearchTiming = options.onSearchTiming
  }

  setProviders(providers: SearchIndexProvider[]) {
    this.providers = providers
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  /** Monotonic version — changes whenever the item set is reloaded. */
  get version(): number {
    return this.versionCounter
  }

  /** Effective ranking config (defaults merged with constructor overrides). */
  get ranking(): RankingConfig {
    return this.defaultRanking
  }

  /** Load every provider once (per cacheKey); safe to call concurrently. */
  ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      const settled = await Promise.allSettled(this.providers.map((p) => this.loadProvider(p)))
      // Rebuild contributions keyed by provider id: fulfilled providers
      // replace their slice, failed/removed providers drop theirs. Keying by
      // id (not id::cacheKey) means a cacheKey change replaces the slice
      // instead of leaving stale items behind.
      const liveIds = new Set<string>()
      this.providers.forEach((provider, index) => {
        liveIds.add(provider.id)
        const result = settled[index]
        if (result?.status === "fulfilled") {
          this.contributions.set(provider.id, result.value)
        } else {
          this.contributions.delete(provider.id)
        }
      })
      for (const id of [...this.contributions.keys()]) {
        if (!liveIds.has(id)) this.contributions.delete(id)
      }
      this.items = [...this.contributions.values()].flat()
      this.loaded = true
      this.versionCounter += 1
      this.invalidatePrepared()
    })().finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  /**
   * Incrementally load a single provider and merge its items — used for
   * lazy domain indexes that arrive after the first paint. Bumps `version`;
   * calling it again with the same provider key replaces that slice.
   */
  async addProvider(provider: SearchIndexProvider): Promise<void> {
    const items = await this.loadProvider(provider)
    this.contributions.set(provider.id, items)
    this.items = [...this.contributions.values()].flat()
    this.loaded = true
    this.versionCounter += 1
    this.invalidatePrepared()
  }

  private loadProvider(provider: SearchIndexProvider): Promise<SearchItem[]> {
    const key = `${provider.id}::${provider.cacheKey ?? ""}`
    const cached = this.entries.get(key)
    if (cached) return cached

    const promise = Promise.resolve()
      .then(() => provider.load())
      .catch((error) => {
        // Drop failed loads so a later ensureLoaded() can retry.
        this.entries.delete(key)
        throw error
      })
    this.entries.set(key, promise)
    return promise
  }

  /** All currently loaded items (unsorted, unfiltered). */
  getItems(): SearchItem[] {
    return this.items
  }

  /**
   * Build (or rebuild) the prepared layer: fields pre-lowercased once so
   * per-query scoring skips repeated `toLowerCase` work. Synchronous; call
   * from idle time after `ensureLoaded()`.
   */
  prepare(): void {
    this.prepared = prepareItems(this.items)
    this.preparedVersion = this.versionCounter
  }

  /**
   * Incremental variant of `prepare()`: processes items in chunks so a large
   * index doesn't block the main thread. Safe to call concurrently — only
   * the first call runs; later calls await the in-flight build.
   */
  prepareIncremental(options?: {
    chunkSize?: number
    onProgress?: (done: number, total: number) => void
  }): Promise<void> {
    if (this.prepared && this.preparedVersion === this.versionCounter) return Promise.resolve()
    if (this.incrementalPromise) return this.incrementalPromise
    const versionAtStart = this.versionCounter
    this.incrementalPromise = prepareItemsIncremental(this.items, options)
      .then((prepared) => {
        // Only adopt if the item set didn't change mid-build.
        if (this.versionCounter === versionAtStart) {
          this.prepared = prepared
          this.preparedVersion = versionAtStart
        }
      })
      .finally(() => {
        this.incrementalPromise = null
      })
    return this.incrementalPromise
  }

  private incrementalPromise: Promise<void> | null = null

  private invalidatePrepared() {
    this.prepared = null
    this.preparedVersion = -1
  }

  private ensurePrepared(): PreparedItem[] | null {
    if (this.prepared && this.preparedVersion === this.versionCounter) return this.prepared
    // Lazy fallback: build synchronously on first search if nobody prepared.
    if (this.items.length > 0 && this.prepared === null) {
      this.prepare()
    }
    return this.prepared
  }

  /**
   * Fuzzy-search the loaded items.
   *
   * An empty query returns every item ordered by frecency + personalization;
   * a non-empty query expands synonyms (unless disabled), scores every
   * variant, keeps each item's best score, subtracts the configured
   * recency/personalization boosts, then applies `options.filters`.
   */
  search(query: string, now: number = Date.now(), options: SearchOptions = {}): SearchHit[] {
    const q = query.trim()
    const ranking = resolveRanking({ ...this.defaultRanking, ...options.ranking })
    const filters = options.filters

    const run = () => {
      const hits = this.scoreItems(q, now, ranking)
      const filtered = filters ? applySearchFilters(hits, filters) : hits
      return filtered.sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
    }

    const variantCount =
      q && ranking.synonyms && this.synonyms ? expandQuery(q, this.synonyms).length : 1

    return timeSearch(q, this.items.length, variantCount, run, this.onSearchTiming)
  }

  private scoreItems(q: string, now: number, ranking: RankingConfig): SearchHit[] {
    const recencyMap = readRecencyMap(now)
    const persMap = ranking.personalization ? readPersonalizationMap(now) : null
    const prepared = this.ensurePrepared()

    // Recency/personalization maps are read once per query, not per item.
    const boostFor = (id: string): number => {
      let boost = frecencyFromMap(recencyMap, id, now) * ranking.recencyBoost
      if (persMap) {
        boost += personalizationScoreFromEntry(persMap.get(id), now) * ranking.personalizationBoost
      }
      return boost
    }

    const penalties: FieldPenalties = {
      title: ranking.titlePenalty,
      subtitle: ranking.subtitlePenalty,
      keywords: ranking.keywordsPenalty,
    }

    if (!q) {
      // Empty query: every item matches; order purely by usage boosts.
      const source =
        prepared ?? this.items.map((item) => ({ item, title: "", subtitle: "", keywords: "" }))
      const hits: SearchHit[] = []
      for (const entry of source) {
        hits.push({ item: entry.item, score: -boostFor(entry.item.id) })
      }
      return hits
    }

    const variants = ranking.synonyms && this.synonyms ? expandQuery(q, this.synonyms) : [q]
    const lowerVariants = variants.map((variant) => variant.toLowerCase())

    const hits: SearchHit[] = []
    if (prepared) {
      for (const entry of prepared) {
        const base = this.bestVariantScore(lowerVariants, entry, penalties)
        if (base === null) continue
        hits.push({ item: entry.item, score: base - boostFor(entry.item.id) })
      }
    } else {
      for (const item of this.items) {
        const fields = {
          title: item.title,
          subtitle: item.subtitle,
          keywords: item.keywords,
        }
        let base: number | null = null
        for (const variant of variants) {
          const score = scoreSearchFields(variant, fields, penalties)
          if (score !== null && (base === null || score < base)) base = score
        }
        if (base === null) continue
        hits.push({ item, score: base - boostFor(item.id) })
      }
    }
    return hits
  }

  /** Best (lowest) field score across query variants for a prepared item. */
  private bestVariantScore(
    lowerVariants: string[],
    entry: PreparedItem,
    penalties: FieldPenalties,
  ): number | null {
    let best: number | null = null
    const fields = { title: entry.title, subtitle: entry.subtitle, keywords: entry.keywords }
    for (const variant of lowerVariants) {
      const score = scoreSearchFieldsNormalized(variant, fields, penalties)
      if (score !== null && (best === null || score < best)) best = score
    }
    return best
  }
}

// Re-exported so consumers can type cache keys and timing hooks without
// reaching into the submodule.
export type { SearchFilters } from "./filters"
export type { RankingConfig } from "./ranking"
export type { SearchTiming, TimingSink } from "./index-build"
export { rankingKey } from "./ranking"
export { searchCacheKey } from "./cache"
