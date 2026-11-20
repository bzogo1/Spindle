import { RECENCY_BOOST } from "./recency"

/**
 * Configurable ranking weights for `SearchIndex` (and anything else that
 * scores `SearchItem`s). Scores are "lower is better": field penalties add to
 * the fuzzy score, while the recency and personalization boosts subtract from
 * it. Every knob is exposed so callers (and tests) can prove that ordering
 * changes when weights change.
 *
 * The defaults reproduce the historical behavior: title matches rank above
 * subtitle matches, which rank above keyword-only matches, with a frecency
 * boost of `RECENCY_BOOST` (150) and a personalization boost of 80.
 */
export type RankingConfig = {
  /** Additive penalty for a match found only in the title field's rivals. */
  titlePenalty: number
  /** Additive penalty when the best match is in the subtitle. */
  subtitlePenalty: number
  /** Additive penalty when the best match is in keywords. */
  keywordsPenalty: number
  /**
   * Score units subtracted at maximum frecency (`frecency() === 1`).
   * Set to 0 to disable the recency boost entirely.
   */
  recencyBoost: number
  /**
   * Score units subtracted at `personalizationScore() === 1`. Set to 0 (or
   * `personalization: false` in SearchOptions) to disable personalization.
   */
  personalizationBoost: number
  /** Expand the query with synonyms before matching (./synonyms). */
  synonyms: boolean
  /** Apply the personalization boost while scoring. */
  personalization: boolean
}

export const DEFAULT_RANKING: RankingConfig = {
  titlePenalty: 0,
  subtitlePenalty: 20,
  keywordsPenalty: 50,
  recencyBoost: RECENCY_BOOST,
  personalizationBoost: 80,
  synonyms: true,
  personalization: true,
}

/** Merge a partial config over the defaults. */
export function resolveRanking(config?: Partial<RankingConfig>): RankingConfig {
  return { ...DEFAULT_RANKING, ...config }
}

/**
 * Stable string key for a ranking config — used in cache keys so results
 * computed under different weights never collide.
 */
export function rankingKey(config: RankingConfig): string {
  return [
    config.titlePenalty,
    config.subtitlePenalty,
    config.keywordsPenalty,
    config.recencyBoost,
    config.personalizationBoost,
    config.synonyms ? 1 : 0,
    config.personalization ? 1 : 0,
  ].join(":")
}
