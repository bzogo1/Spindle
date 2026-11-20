import { describe, expect, it } from "vitest"

import { DEFAULT_RANKING, rankingKey, resolveRanking } from "./ranking"

describe("resolveRanking", () => {
  it("returns defaults for undefined and merges partials", () => {
    expect(resolveRanking()).toEqual(DEFAULT_RANKING)
    const merged = resolveRanking({ recencyBoost: 0 })
    expect(merged.recencyBoost).toBe(0)
    expect(merged.keywordsPenalty).toBe(DEFAULT_RANKING.keywordsPenalty)
  })
})

describe("rankingKey", () => {
  it("is stable and changes with weights", () => {
    expect(rankingKey(DEFAULT_RANKING)).toBe(rankingKey(resolveRanking()))
    expect(rankingKey(resolveRanking({ recencyBoost: 0 }))).not.toBe(rankingKey(DEFAULT_RANKING))
    expect(rankingKey(resolveRanking({ synonyms: false }))).not.toBe(rankingKey(DEFAULT_RANKING))
  })
})
