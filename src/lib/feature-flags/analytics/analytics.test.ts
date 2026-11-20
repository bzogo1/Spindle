import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { bucketIndex, subjectHash } from "./bucket"
import { flushFlagAnalytics, recordFlagExposure, setFlagAnalyticsSink } from "./recorder"
import { createHttpSink, createJsonlFileSink } from "./sinks"
import type { FlagExposureEvent } from "./types"

function collectSink() {
  const events: FlagExposureEvent[] = []
  return {
    events,
    sink: {
      record(event: FlagExposureEvent) {
        events.push(event)
      },
    },
  }
}

beforeEach(() => {
  setFlagAnalyticsSink(null)
})

afterEach(() => {
  setFlagAnalyticsSink(null)
  vi.restoreAllMocks()
})

describe("bucketIndex", () => {
  it("is deterministic for the same (flag, userKey)", () => {
    expect(bucketIndex("new-dashboard", "user-1")).toBe(bucketIndex("new-dashboard", "user-1"))
  })

  it("stays within [0, bucketCount)", () => {
    for (let i = 0; i < 500; i++) {
      const bucket = bucketIndex("flag", `subject-${i}`, 100)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(100)
    }
  })

  it("respects a custom bucketCount", () => {
    for (let i = 0; i < 200; i++) {
      const bucket = bucketIndex("flag", `subject-${i}`, 10)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(10)
    }
  })

  it("gives the same user independent buckets per flag", () => {
    // With ~100 subjects, at least one flag pair should disagree on buckets
    // for some user — flags must not share rollout cohorts.
    const users = Array.from({ length: 50 }, (_, i) => `user-${i}`)
    const disagreements = users.filter((u) => bucketIndex("flag-a", u) !== bucketIndex("flag-b", u))
    expect(disagreements.length).toBeGreaterThan(0)
  })

  it("spreads subjects roughly evenly across buckets", () => {
    const counts = new Array(100).fill(0)
    const n = 10_000
    for (let i = 0; i < n; i++) {
      counts[bucketIndex("spread-flag", `user-${i}`)]++
    }
    const expected = n / 100
    // Chi-square-lite: no bucket should deviate by more than ~3x expected.
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.3)
      expect(count).toBeLessThan(expected * 3)
    }
  })
})

describe("subjectHash", () => {
  it("is stable and 16 hex chars", () => {
    const hash = subjectHash("flag", "user-1")
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(subjectHash("flag", "user-1")).toBe(hash)
  })

  it("differs across flags for the same user", () => {
    expect(subjectHash("flag-a", "user-1")).not.toBe(subjectHash("flag-b", "user-1"))
  })

  it("does not contain the raw user key", () => {
    const hash = subjectHash("flag", "user@example.com")
    expect(hash).not.toContain("user@example.com")
    expect(hash).not.toContain("user")
  })
})

describe("recordFlagExposure", () => {
  it("emits a complete, non-identifying event to the active sink", () => {
    const { events, sink } = collectSink()
    setFlagAnalyticsSink(sink)

    recordFlagExposure({
      flag: "new-dashboard",
      userKey: "user-secret-id",
      variant: "treatment",
      value: true,
      timestamp: "2025-01-01T00:00:00.000Z",
    })

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.event).toBe("flag_exposure")
    expect(event.kind).toBe("exposure")
    expect(event.flag).toBe("new-dashboard")
    expect(event.variant).toBe("treatment")
    expect(event.value).toBe(true)
    expect(event.bucket).toBe(bucketIndex("new-dashboard", "user-secret-id"))
    expect(event.bucketCount).toBe(100)
    expect(event.subjectHash).toBe(subjectHash("new-dashboard", "user-secret-id"))
    expect(event.environment).toBeTruthy()
    expect(event.timestamp).toBe("2025-01-01T00:00:00.000Z")
    expect(JSON.stringify(event)).not.toContain("user-secret-id")
  })

  it("defaults kind to exposure and variant to null", () => {
    const { events, sink } = collectSink()
    setFlagAnalyticsSink(sink)

    recordFlagExposure({ flag: "bool-flag", userKey: "u1", value: false })

    expect(events[0].kind).toBe("exposure")
    expect(events[0].variant).toBeNull()
  })

  it("supports kind=evaluation and custom bucketCount", () => {
    const { events, sink } = collectSink()
    setFlagAnalyticsSink(sink)

    recordFlagExposure({
      flag: "gated-flag",
      userKey: "u1",
      kind: "evaluation",
      bucketCount: 1000,
    })

    expect(events[0].kind).toBe("evaluation")
    expect(events[0].bucketCount).toBe(1000)
    expect(events[0].bucket).toBeLessThan(1000)
  })

  it("drops invalid input without touching the sink", () => {
    const { events, sink } = collectSink()
    setFlagAnalyticsSink(sink)

    recordFlagExposure({ flag: "", userKey: "u" })
    recordFlagExposure({ flag: "x".repeat(200), userKey: "u" })
    recordFlagExposure({ flag: "ok", userKey: "" })
    // @ts-expect-error runtime guard for JS callers
    recordFlagExposure(null)

    expect(events).toHaveLength(0)
  })

  it("swallows synchronous sink errors", () => {
    setFlagAnalyticsSink({
      record() {
        throw new Error("sink exploded")
      },
    })

    expect(() => recordFlagExposure({ flag: "f", userKey: "u" })).not.toThrow()
  })

  it("swallows async sink rejections", async () => {
    setFlagAnalyticsSink({
      record() {
        return Promise.reject(new Error("async boom"))
      },
    })

    expect(() => recordFlagExposure({ flag: "f", userKey: "u" })).not.toThrow()
    await flushFlagAnalytics()
  })

  it("honours an explicitly provided decision bucket", () => {
    const { events, sink } = collectSink()
    setFlagAnalyticsSink(sink)

    recordFlagExposure({ flag: "f", userKey: "u1", bucket: 42, bucketCount: 100 })
    recordFlagExposure({ flag: "f", userKey: "u1", bucket: 999, bucketCount: 100 })

    expect(events[0].bucket).toBe(42)
    // Out-of-range values are clamped into [0, bucketCount).
    expect(events[1].bucket).toBe(99)
  })

  it("degrades unserialisable values instead of throwing", () => {
    const { events, sink } = collectSink()
    setFlagAnalyticsSink(sink)
    const circular: Record<string, unknown> = {}
    circular.self = circular

    recordFlagExposure({ flag: "f", userKey: "u", value: circular })
    recordFlagExposure({ flag: "f", userKey: "u", value: 10n })

    expect(events[0].value).toBe("[unserializable]")
    expect(events[1].value).toBe("10")
  })
})

describe("createJsonlFileSink", () => {
  it("appends one JSON event per line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flag-analytics-"))
    const file = join(dir, "events.jsonl")
    const jsonl = createJsonlFileSink(file)
    setFlagAnalyticsSink(jsonl)

    recordFlagExposure({ flag: "f", userKey: "u1", variant: "a" })
    recordFlagExposure({ flag: "f", userKey: "u2", variant: "b" })
    await flushFlagAnalytics()

    const lines = readFileSync(file, "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    const parsed = lines.map((line) => JSON.parse(line) as FlagExposureEvent)
    expect(parsed[0].flag).toBe("f")
    expect(parsed[0].subjectHash).toBe(subjectHash("f", "u1"))
    expect(parsed[1].subjectHash).toBe(subjectHash("f", "u2"))

    rmSync(dir, { recursive: true, force: true })
  })
})

describe("createHttpSink", () => {
  it("batches events and POSTs a JSON envelope on flush", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    const http = createHttpSink("https://example.test/flags", { batchSize: 2 })
    setFlagAnalyticsSink(http)

    recordFlagExposure({ flag: "f", userKey: "u1" })
    expect(fetchMock).not.toHaveBeenCalled()

    recordFlagExposure({ flag: "f", userKey: "u2" }) // triggers auto-flush
    await flushFlagAnalytics()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://example.test/flags")
    const body = JSON.parse(String(init.body)) as { events: FlagExposureEvent[] }
    expect(body.events).toHaveLength(2)
    expect(body.events[0].event).toBe("flag_exposure")
  })

  it("swallows fetch failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    const http = createHttpSink("https://example.test/flags")
    setFlagAnalyticsSink(http)

    recordFlagExposure({ flag: "f", userKey: "u1" })
    await expect(flushFlagAnalytics()).resolves.toBeUndefined()
  })
})
