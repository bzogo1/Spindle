import { beforeEach, describe, expect, it } from "vitest"

import { lookupRunCache, RunCache, type RunCacheStorage } from "./cache"
import { runInputHash } from "./hash"
import { makeRun } from "./fixtures"

function memoryStorage(): RunCacheStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  }
}

describe("RunCache", () => {
  let storage: ReturnType<typeof memoryStorage>
  let cache: RunCache

  beforeEach(() => {
    storage = memoryStorage()
    cache = new RunCache(storage)
  })

  it("stores and retrieves a run by input hash", () => {
    const run = makeRun({ status: "completed" })
    const entry = cache.set(run)
    expect(entry.hash).toBe(runInputHash({ prompt: run.prompt, model: run.model }))
    const hit = cache.get(entry.hash)
    expect(hit?.run.id).toBe(run.id)
    expect(cache.has(entry.hash)).toBe(true)
  })

  it("misses for different prompts or models", () => {
    cache.set(makeRun({ status: "completed" }))
    const other = runInputHash({ prompt: "other", model: "gpt-4o" })
    expect(cache.get(other)).toBeNull()
    const otherModel = runInputHash({
      prompt: "Summarize the quarterly report",
      model: "claude-opus",
    })
    expect(cache.get(otherModel)).toBeNull()
  })

  it("does not count incomplete runs as cacheable hits", () => {
    const run = makeRun({ status: "running" })
    cache.set(run)
    const hash = runInputHash({ prompt: run.prompt, model: run.model })
    expect(cache.get(hash)).not.toBeNull()
    expect(cache.has(hash)).toBe(false)
  })

  it("setIfCacheable skips non-completed runs", () => {
    expect(cache.setIfCacheable(makeRun({ status: "failed" }))).toBeNull()
    expect(cache.setIfCacheable(makeRun({ status: "completed" }))).not.toBeNull()
  })

  it("getForReplay increments hit counters and stamps metrics", () => {
    const run = makeRun({ status: "completed" })
    const { hash } = cache.set(run)
    const first = cache.getForReplay(hash)
    const second = cache.getForReplay(hash)
    expect(first?.run.metrics.cacheHits).toBe(1)
    expect(second?.run.metrics.cacheHits).toBe(2)
    expect(second?.entry.hits).toBe(2)
  })

  it("expires entries past the TTL", () => {
    const ttlCache = new RunCache(storage, { ttlMs: 1000 })
    const run = makeRun({ status: "completed" })
    const { hash } = ttlCache.set(run)
    const realNow = Date.now
    Date.now = () => realNow() + 2000
    try {
      expect(ttlCache.get(hash)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  it("evicts oldest entries beyond maxEntries", () => {
    const small = new RunCache(storage, { maxEntries: 2 })
    small.set(makeRun({ id: "r1", prompt: "one", status: "completed" }))
    small.set(makeRun({ id: "r2", prompt: "two", status: "completed" }))
    small.set(makeRun({ id: "r3", prompt: "three", status: "completed" }))
    expect(small.list()).toHaveLength(2)
    expect(small.list().map((e) => e.run.id)).not.toContain("r1")
  })

  it("delete and clear remove entries", () => {
    const run = makeRun({ status: "completed" })
    const { hash } = cache.set(run)
    expect(cache.delete(hash)).toBe(true)
    expect(cache.delete(hash)).toBe(false)
    cache.set(makeRun({ id: "r2", prompt: "two", status: "completed" }))
    cache.clear()
    expect(cache.list()).toHaveLength(0)
  })

  it("tolerates corrupt payloads", () => {
    storage.setItem("agent-run-cache:v1:bad", "{not json")
    expect(cache.list()).toHaveLength(0)
    expect(cache.get("bad")).toBeNull()
  })

  it("works without storage (SSR)", () => {
    const noop = new RunCache(null)
    const run = makeRun({ status: "completed" })
    expect(() => noop.set(run)).not.toThrow()
    expect(noop.get("anything")).toBeNull()
    expect(noop.has("anything")).toBe(false)
  })
})

describe("lookupRunCache", () => {
  it("reports hit/miss with hash", () => {
    const storage = memoryStorage()
    const cache = new RunCache(storage)
    const run = makeRun({ status: "completed" })
    cache.set(run)

    const hit = lookupRunCache({ prompt: run.prompt, model: run.model }, cache)
    expect(hit.hit).toBe(true)
    expect(hit.entry?.run.id).toBe(run.id)

    const miss = lookupRunCache({ prompt: "nope", model: run.model }, cache)
    expect(miss.hit).toBe(false)
    expect(miss.hash).toBe(runInputHash({ prompt: "nope", model: run.model }))
  })
})
