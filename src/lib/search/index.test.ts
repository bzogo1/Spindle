import { beforeEach, describe, expect, it, vi } from "vitest"

import { fuzzyScore, scoreSearchFields } from "./fuzzy"
import { SearchIndex, type SearchIndexProvider, type SearchItem } from "./index"
import { RECENTS_STORAGE_KEY, frecency, readRecencyMap, recordUse } from "./recency"
import { recordSearchClick } from "./personalization"

function item(partial: Partial<SearchItem> & Pick<SearchItem, "id" | "title">): SearchItem {
  return { group: "Pages", ...partial }
}

function provider(id: string, items: SearchItem[]): SearchIndexProvider {
  return { id, group: "Pages", load: () => items }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe("fuzzyScore", () => {
  it("returns 0 for an empty query and null for non-subsequences", () => {
    expect(fuzzyScore("", "anything")).toBe(0)
    expect(fuzzyScore("xyz", "Dashboard")).toBeNull()
  })

  it("prefers substring hits over scattered subsequence matches", () => {
    const substring = fuzzyScore("dash", "Dashboard")
    const scattered = fuzzyScore("dsh", "Dashboard")

    expect(substring).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(substring!).toBeLessThan(scattered!)
  })

  it("is case-insensitive", () => {
    expect(fuzzyScore("TIDE", "tide pool")).not.toBeNull()
  })
})

describe("scoreSearchFields", () => {
  it("matches on title, subtitle, or keywords with field penalties", () => {
    const fields = { title: "Settings", subtitle: "Preferences", keywords: "account profile" }

    expect(scoreSearchFields("set", fields)).not.toBeNull()
    expect(scoreSearchFields("pref", fields)).not.toBeNull()
    expect(scoreSearchFields("profile", fields)).not.toBeNull()
    expect(scoreSearchFields("zzz", fields)).toBeNull()
  })

  it("ranks a title hit above the same hit in keywords", () => {
    const titleHit = scoreSearchFields("lab", { title: "Lab", keywords: "collaboration" })
    const keywordHit = scoreSearchFields("lab", { title: "Overview", keywords: "collaboration" })

    expect(titleHit).not.toBeNull()
    expect(keywordHit).not.toBeNull()
    expect(titleHit!).toBeLessThan(keywordHit!)
  })
})

describe("SearchIndex.search", () => {
  it("filters items to those matching the query", async () => {
    const index = new SearchIndex([
      provider("pages", [
        item({ id: "page:/dashboard", title: "Dashboard" }),
        item({ id: "page:/settings", title: "Settings" }),
      ]),
      provider("projects", [
        item({ id: "project:prj_01", title: "Tide Pool Survey", group: "Projects" }),
      ]),
    ])

    await index.ensureLoaded()

    const hits = index.search("tidepool")
    expect(hits.map((hit) => hit.item.id)).toEqual(["project:prj_01"])
    expect(index.search("zzz-no-match")).toEqual([])
  })

  it("returns every item for an empty query", async () => {
    const index = new SearchIndex([
      provider("pages", [item({ id: "a", title: "Alpha" }), item({ id: "b", title: "Beta" })]),
    ])

    await index.ensureLoaded()

    expect(
      index
        .search("")
        .map((hit) => hit.item.id)
        .sort(),
    ).toEqual(["a", "b"])
    expect(index.search("   ")).toHaveLength(2)
  })

  it("boosts recently used items above equal fuzzy matches", async () => {
    const now = Date.now()
    recordUse("page:/settings", now)

    const index = new SearchIndex([
      provider("pages", [
        item({ id: "page:/settings", title: "Settings" }),
        item({ id: "page:/setup", title: "Setup" }),
      ]),
    ])

    await index.ensureLoaded()

    const hits = index.search("s", now)
    expect(hits[0]?.item.id).toBe("page:/settings")
    // The boost subtracts from the score, so the used item ranks first.
    expect(hits[0]!.score).toBeLessThan(hits[1]!.score)
  })

  it("orders equal-score hits alphabetically by title", async () => {
    const index = new SearchIndex([
      provider("pages", [item({ id: "b", title: "Zulu" }), item({ id: "a", title: "Alpha" })]),
    ])

    await index.ensureLoaded()

    const hits = index.search("zzzzz-nomatch")
    expect(hits).toEqual([])

    const all = index.search("")
    // Both score 0 (no recency); titles sort alphabetically.
    expect(all.map((hit) => hit.item.title)).toEqual(["Alpha", "Zulu"])
  })
})

describe("SearchIndex.search — ranking, synonyms, filters, personalization", () => {
  it("changes ordering when ranking weights change", async () => {
    // "lab" hits item A's title and item B's keywords only.
    const index = new SearchIndex([
      provider("mixed", [
        item({ id: "a", title: "Lab", keywords: "zzz" }),
        item({ id: "b", title: "Overview", keywords: "collaboration lab" }),
      ]),
    ])
    await index.ensureLoaded()

    const defaultOrder = index.search("lab").map((h) => h.item.id)
    expect(defaultOrder[0]).toBe("a") // title hit wins by default

    // Crank the keyword penalty to zero and drop the title advantage: the
    // keyword-only item can now win.
    const tuned = index.search("lab", Date.now(), {
      ranking: {
        titlePenalty: 500,
        subtitlePenalty: 20,
        keywordsPenalty: 0,
        recencyBoost: 0,
        personalizationBoost: 0,
      },
    })
    expect(tuned[0]!.item.id).toBe("b")
  })

  it("expands synonyms at query time", async () => {
    const index = new SearchIndex(
      [provider("pages", [item({ id: "ep", title: "Endpoint reference", group: "Docs" })])],
      { synonyms: { api: ["endpoint"] } },
    )
    await index.ensureLoaded()

    // "api" does not fuzzy-match "Endpoint reference" literally…
    expect(index.search("api", Date.now(), { ranking: { synonyms: false } })).toEqual([])
    // …but the synonym variant "endpoint" does.
    expect(index.search("api").map((h) => h.item.id)).toContain("ep")
  })

  it("can disable synonym expansion", async () => {
    const index = new SearchIndex(
      [provider("pages", [item({ id: "ep", title: "Endpoint reference" })])],
      { synonyms: { api: ["endpoint"] } },
    )
    await index.ensureLoaded()
    expect(index.search("api", Date.now(), { ranking: { synonyms: false } })).toEqual([])
  })

  it("applies filters to results", async () => {
    const index = new SearchIndex([
      provider("mixed", [
        item({ id: "page:/x", title: "Export", type: "page", section: "Product" }),
        item({ id: "doc:g:s", title: "Export guide", type: "doc", section: "Guides" }),
      ]),
    ])
    await index.ensureLoaded()

    expect(
      index.search("export", Date.now(), { filters: { types: ["doc"] } }).map((h) => h.item.id),
    ).toEqual(["doc:g:s"])
    expect(
      index
        .search("export", Date.now(), { filters: { sections: ["Product"] } })
        .map((h) => h.item.id),
    ).toEqual(["page:/x"])
  })

  it("boosts personalization-clicked items", async () => {
    const now = Date.now()
    // "Annual report" scores ~70 for query "report"; "Report" scores 0.
    for (let i = 0; i < 10; i += 1) recordSearchClick("page:/a", now)

    const index = new SearchIndex([
      provider("pages", [
        item({ id: "page:/a", title: "Annual report" }),
        item({ id: "page:/b", title: "Report" }),
      ]),
    ])
    await index.ensureLoaded()

    // With a large personalization weight the clicked item overtakes.
    const boosted = index.search("report", now, { ranking: { personalizationBoost: 200 } })
    expect(boosted[0]!.item.id).toBe("page:/a")

    // Default weights: text score still wins (0 < ~10 after the 80-pt boost).
    const plain = index.search("report", now)
    expect(plain[0]!.item.id).toBe("page:/b")

    // Disabling personalization restores pure text-score order.
    const noPersonal = index.search("report", now, { ranking: { personalization: false } })
    expect(noPersonal[0]!.item.id).toBe("page:/b")
  })
})

describe("SearchIndex versioning, providers, and prepared index", () => {
  it("bumps version on load and on addProvider", async () => {
    const index = new SearchIndex([provider("a", [item({ id: "a", title: "Alpha" })])])
    const v0 = index.version
    await index.ensureLoaded()
    expect(index.version).toBe(v0 + 1)

    await index.addProvider(provider("b", [item({ id: "b", title: "Beta", group: "Docs" })]))
    expect(index.version).toBe(v0 + 2)
    expect(
      index
        .search("")
        .map((h) => h.item.id)
        .sort(),
    ).toEqual(["a", "b"])
  })

  it("addProvider replaces a slice when the same provider id reloads", async () => {
    const index = new SearchIndex()
    await index.addProvider({
      id: "p",
      group: "Pages",
      cacheKey: "v1",
      load: () => [item({ id: "old", title: "Old" })],
    })
    // Same provider id with a new cacheKey → fresh load replaces the slice.
    await index.addProvider({
      id: "p",
      group: "Pages",
      cacheKey: "v2",
      load: () => [item({ id: "new", title: "New" })],
    })
    expect(index.search("").map((h) => h.item.id)).toEqual(["new"])
  })

  it("prepare() and prepareIncremental() produce identical search results", async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      item({ id: `i${i}`, title: `Entry number ${i}`, keywords: `keyword${i} body text` }),
    )
    const indexA = new SearchIndex([provider("big", items)])
    const indexB = new SearchIndex([provider("big", items)])
    await Promise.all([indexA.ensureLoaded(), indexB.ensureLoaded()])

    indexA.prepare()
    await indexB.prepareIncremental({ chunkSize: 7 })

    for (const q of ["entry", "keyword3", "body", "zzz"]) {
      expect(indexA.search(q).map((h) => h.item.id)).toEqual(indexB.search(q).map((h) => h.item.id))
    }
  })

  it("fires onSearchTiming with query stats", async () => {
    const onSearchTiming = vi.fn()
    const index = new SearchIndex([provider("p", [item({ id: "a", title: "Alpha" })])], {
      onSearchTiming,
    })
    await index.ensureLoaded()
    index.search("alpha")
    expect(onSearchTiming).toHaveBeenCalledTimes(1)
    expect(onSearchTiming.mock.calls[0]![0]).toMatchObject({
      query: "alpha",
      itemCount: 1,
      variantCount: expect.any(Number),
    })
  })
})

describe("recency store", () => {
  it("records uses and exposes frecency and recent ids", () => {
    const now = 1_000_000
    recordUse("item:a", now)
    recordUse("item:b", now - 60_000)
    recordUse("item:a", now)

    const map = readRecencyMap(now)
    expect(map.get("item:a")?.count).toBe(2)
    expect(map.get("item:b")?.count).toBe(1)
    expect(frecency("item:a", now)).toBeGreaterThan(frecency("item:b", now))
    expect(frecency("item:never", now)).toBe(0)
    expect(window.localStorage.getItem(RECENTS_STORAGE_KEY)).toContain("item:a")
  })
})
