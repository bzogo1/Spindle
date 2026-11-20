import { describe, expect, it } from "vitest"

import { parseConnectionUrlList, resolveReplicaDatabaseUrls } from "./config"

describe("parseConnectionUrlList", () => {
  it("returns an empty list for undefined or blank input", () => {
    expect(parseConnectionUrlList(undefined)).toEqual([])
    expect(parseConnectionUrlList("")).toEqual([])
    expect(parseConnectionUrlList("   ")).toEqual([])
  })

  it("splits on commas, trims entries, and drops empties", () => {
    expect(
      parseConnectionUrlList(" postgresql://a/db , , postgresql://b/db ,postgresql://c/db "),
    ).toEqual(["postgresql://a/db", "postgresql://b/db", "postgresql://c/db"])
  })

  it("deduplicates while preserving first-seen order", () => {
    expect(
      parseConnectionUrlList("postgresql://a/db, postgresql://b/db, postgresql://a/db"),
    ).toEqual(["postgresql://a/db", "postgresql://b/db"])
  })
})

describe("resolveReplicaDatabaseUrls", () => {
  it("returns an empty list when nothing is configured", () => {
    expect(resolveReplicaDatabaseUrls({})).toEqual([])
  })

  it("reads a single replica from REPLICA_DATABASE_URL", () => {
    expect(
      resolveReplicaDatabaseUrls({
        REPLICA_DATABASE_URL: "postgresql://replica/db",
      }),
    ).toEqual(["postgresql://replica/db"])
  })

  it("reads an ordered list from REPLICA_DATABASE_URLS", () => {
    expect(
      resolveReplicaDatabaseUrls({
        REPLICA_DATABASE_URLS: "postgresql://r1/db, postgresql://r2/db",
      }),
    ).toEqual(["postgresql://r1/db", "postgresql://r2/db"])
  })

  it("combines both vars, list entries first, deduplicated", () => {
    expect(
      resolveReplicaDatabaseUrls({
        REPLICA_DATABASE_URL: "postgresql://single/db",
        REPLICA_DATABASE_URLS: "postgresql://r1/db, postgresql://single/db",
      }),
    ).toEqual(["postgresql://r1/db", "postgresql://single/db"])
  })
})
