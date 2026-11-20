import { describe, expect, it } from "vitest"

import { buildChunks, hashBlob } from "./chunker"

function makeBlob(size: number, fill = 0x61): Blob {
  return new Blob([new Uint8Array(size).fill(fill)])
}

describe("buildChunks", () => {
  it("splits a blob into ordered chunks of the requested size", () => {
    const blob = makeBlob(25)
    const chunks = buildChunks(blob, 10)

    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.index)).toEqual([1, 2, 3])
    expect(chunks.map((c) => c.size)).toEqual([10, 10, 5])
    expect(chunks.map((c) => c.start)).toEqual([0, 10, 20])
    expect(chunks.map((c) => c.end)).toEqual([10, 20, 25])
  })

  it("produces a single chunk when the blob fits in one part", () => {
    const chunks = buildChunks(makeBlob(10), 1024)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ index: 1, start: 0, end: 10, size: 10 })
  })

  it("returns one zero-byte chunk for an empty blob", () => {
    const chunks = buildChunks(makeBlob(0), 10)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].size).toBe(0)
  })

  it("chunk blobs preserve the underlying bytes", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const chunks = buildChunks(new Blob([data]), 2)
    const bytes = await Promise.all(chunks.map((c) => c.blob.arrayBuffer()))
    expect(bytes.map((b) => Array.from(new Uint8Array(b)))).toEqual([[1, 2], [3, 4], [5]])
  })

  it("rejects invalid chunk sizes", () => {
    expect(() => buildChunks(makeBlob(1), 0)).toThrow(RangeError)
    expect(() => buildChunks(makeBlob(1), -5)).toThrow(RangeError)
    expect(() => buildChunks(makeBlob(1), Number.NaN)).toThrow(RangeError)
  })
})

describe("hashBlob", () => {
  it("is deterministic and content-dependent", async () => {
    const a = await hashBlob(makeBlob(8, 0x61))
    const b = await hashBlob(makeBlob(8, 0x61))
    const c = await hashBlob(makeBlob(8, 0x62))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^(sha256|fnv1a):[0-9a-f]+$/)
  })
})
