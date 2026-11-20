import { describe, expect, it } from "vitest"

import {
  createSharePayload,
  decodeSharePayload,
  decodeSharePayloadFromUrl,
  encodeSharePayload,
  encodeSharePayloadForUrl,
  sharePayloadFromLocation,
} from "./share"

describe("share payloads", () => {
  it("round-trips through JSON encoding", () => {
    const payload = createSharePayload({
      nodeIds: ["a", "b"],
      filters: { bookmarkOnly: true, tagIds: ["t1"] },
      expandedIds: ["docs"],
      bookmarks: ["a"],
      favorites: ["b"],
      tags: { t1: ["a"] },
      name: "review set",
      now: new Date("2025-01-01T00:00:00Z"),
    })
    const decoded = decodeSharePayload(encodeSharePayload(payload))
    expect(decoded).toEqual(payload)
    expect(decoded?.version).toBe(1)
    expect(decoded?.createdAt).toBe("2025-01-01T00:00:00.000Z")
  })

  it("round-trips through URL-safe encoding", () => {
    const payload = createSharePayload({ nodeIds: ["x"], name: "héllo wörld ✓" })
    const url = encodeSharePayloadForUrl(payload)
    expect(url).not.toContain("=") // padding stripped
    const decoded = decodeSharePayloadFromUrl(url)
    expect(decoded?.nodeIds).toEqual(["x"])
    expect(decoded?.name).toBe("héllo wörld ✓")
  })

  it("rejects malformed payloads", () => {
    expect(decodeSharePayload("not json")).toBeNull()
    expect(decodeSharePayload('{"version":2,"nodeIds":[]}')).toBeNull()
    expect(decodeSharePayload('{"version":1}')).toBeNull() // nodeIds missing
    expect(decodeSharePayloadFromUrl("!!!")).toBeNull()
  })

  it("rejects payloads with wrongly-typed fields", () => {
    const bad = [
      '{"version":1,"nodeIds":"a"}', // nodeIds not array
      '{"version":1,"nodeIds":[1,2]}', // non-string ids
      '{"version":1,"nodeIds":[],"expandedIds":"x"}',
      '{"version":1,"nodeIds":[],"bookmarks":{}}',
      '{"version":1,"nodeIds":[],"favorites":[null]}',
      '{"version":1,"nodeIds":[],"tags":{"t":"not-array"}}',
      '{"version":1,"nodeIds":[],"tags":["t"]}',
      '{"version":1,"nodeIds":[],"filters":"yes"}',
      '{"version":1,"nodeIds":[],"filters":{"bookmarkOnly":"yes"}}',
      '{"version":1,"nodeIds":[],"filters":{"tagIds":"t1"}}',
      '{"version":1,"nodeIds":[],"name":42}',
    ]
    for (const raw of bad) {
      expect(decodeSharePayload(raw), raw).toBeNull()
    }
  })

  it("accepts payloads with valid optional fields", () => {
    const decoded = decodeSharePayload(
      '{"version":1,"nodeIds":["a"],"filters":{"bookmarkOnly":true,"tagIds":["t"]},"tags":{"t":["a"]}}',
    )
    expect(decoded?.filters).toEqual({ bookmarkOnly: true, tagIds: ["t"] })
    expect(decoded?.tags).toEqual({ t: ["a"] })
  })

  it("round-trips payloads containing literal % sequences", () => {
    const tricky = '100% sure — 50%25 off "quote" %20 literal'
    const payload = createSharePayload({
      nodeIds: ["a%20b", "c%"],
      name: tricky,
      bookmarks: ["x%25y"],
    })
    // JSON transport
    expect(decodeSharePayload(encodeSharePayload(payload))?.name).toBe(tricky)
    // URL transport (base64url in jsdom)
    const url = encodeSharePayloadForUrl(payload)
    const decoded = decodeSharePayloadFromUrl(url)
    expect(decoded?.name).toBe(tricky)
    expect(decoded?.nodeIds).toEqual(["a%20b", "c%"])
    expect(decoded?.bookmarks).toEqual(["x%25y"])
    // URI-encoded transport form (encoder fallback shape)
    const uriForm = encodeURIComponent(encodeSharePayload(payload))
    expect(decodeSharePayloadFromUrl(uriForm)?.name).toBe(tricky)
    // Raw JSON containing % must not be URI-decoded or rejected.
    expect(decodeSharePayload(encodeSharePayload(payload))?.name).toBe(tricky)
  })

  it("extracts share payloads from location hashes and query strings", () => {
    const payload = createSharePayload({ nodeIds: ["n1"] })
    const encoded = encodeSharePayloadForUrl(payload)
    expect(sharePayloadFromLocation(`https://app.example/#share=${encoded}`)?.nodeIds).toEqual([
      "n1",
    ])
    expect(sharePayloadFromLocation(`https://app.example/?share=${encoded}`)?.nodeIds).toEqual([
      "n1",
    ])
    expect(sharePayloadFromLocation("https://app.example/")).toBeNull()
  })
})
