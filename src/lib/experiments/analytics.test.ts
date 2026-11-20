import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  EXPERIMENT_EXPOSURE_EVENT,
  EXPERIMENT_METRIC_EVENT,
  flushExperimentAnalytics,
  recordExperimentExposure,
  recordExperimentMetric,
  setExperimentAnalyticsSink,
  type ExperimentEvent,
} from "./analytics"
import { createConsoleSink, createJsonlFileSink } from "./sinks"

function collectSink() {
  const events: ExperimentEvent[] = []
  return {
    events,
    sink: {
      record(event: ExperimentEvent) {
        events.push(event)
      },
    },
  }
}

beforeEach(() => {
  setExperimentAnalyticsSink(null)
})

afterEach(() => {
  setExperimentAnalyticsSink(null)
  vi.restoreAllMocks()
})

describe("recordExperimentExposure", () => {
  it("builds a well-formed exposure event with a hashed subject", () => {
    const { events, sink } = collectSink()
    setExperimentAnalyticsSink(sink)

    recordExperimentExposure({
      experiment: "checkout-cta",
      subjectId: "user-123",
      variant: "treatment",
      bucket: 4242,
      timestamp: "2025-01-01T00:00:00Z",
    })

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.event).toBe(EXPERIMENT_EXPOSURE_EVENT)
    expect(event.kind).toBe("exposure")
    expect(event.experiment).toBe("checkout-cta")
    expect(event.variant).toBe("treatment")
    expect(event.metric).toBeNull()
    expect(event.value).toBeNull()
    expect(event.bucket).toBe(4242)
    expect(event.bucketCount).toBe(10_000)
    expect(event.subjectHash).toMatch(/^[0-9a-f]{16}$/)
    expect(event.timestamp).toBe("2025-01-01T00:00:00.000Z")
    // The raw subject id must never appear in the event.
    expect(JSON.stringify(event)).not.toContain("user-123")
  })

  it("never lets sink failures escape", () => {
    setExperimentAnalyticsSink({
      record() {
        throw new Error("boom")
      },
    })
    expect(() =>
      recordExperimentExposure({ experiment: "e", subjectId: "s", variant: "v" }),
    ).not.toThrow()
  })

  it("swallows async sink rejections", async () => {
    setExperimentAnalyticsSink({
      record() {
        return Promise.reject(new Error("async boom"))
      },
    })
    expect(() => recordExperimentExposure({ experiment: "e", subjectId: "s" })).not.toThrow()
    await Promise.resolve()
  })

  it("ignores invalid input", () => {
    const { events, sink } = collectSink()
    setExperimentAnalyticsSink(sink)

    recordExperimentExposure({ experiment: "", subjectId: "s" })
    recordExperimentExposure({ experiment: "e", subjectId: "" })
    // @ts-expect-error — runtime validation, not just types
    recordExperimentExposure(null)
    expect(events).toHaveLength(0)
  })

  it("clamps an out-of-range bucket", () => {
    const { events, sink } = collectSink()
    setExperimentAnalyticsSink(sink)
    recordExperimentExposure({
      experiment: "e",
      subjectId: "s",
      bucket: 99_999,
    })
    expect(events[0].bucket).toBe(9_999)
  })
})

describe("recordExperimentMetric", () => {
  it("records metric name and value", () => {
    const { events, sink } = collectSink()
    setExperimentAnalyticsSink(sink)

    recordExperimentMetric({
      experiment: "exp",
      subjectId: "u1",
      variant: "control",
      metric: "signup_completed",
      value: 1,
    })

    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.event).toBe(EXPERIMENT_METRIC_EVENT)
    expect(event.kind).toBe("metric")
    expect(event.metric).toBe("signup_completed")
    expect(event.value).toBe(1)
  })

  it("defaults metric value to 1 and drops nameless metrics", () => {
    const { events, sink } = collectSink()
    setExperimentAnalyticsSink(sink)

    recordExperimentMetric({ experiment: "e", subjectId: "s", metric: "m" })
    recordExperimentMetric({ experiment: "e", subjectId: "s", kind: "metric" })
    expect(events).toHaveLength(1)
    expect(events[0].value).toBe(1)
  })

  it("degrades unserialisable values safely", () => {
    const { events, sink } = collectSink()
    setExperimentAnalyticsSink(sink)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    recordExperimentMetric({
      experiment: "e",
      subjectId: "s",
      metric: "m",
      value: circular,
    })
    expect(events[0].value).toBe("[unserializable]")
  })
})

describe("sinks", () => {
  it("createConsoleSink emits a debug line", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {})
    const sink = createConsoleSink()
    sink.record({
      event: EXPERIMENT_EXPOSURE_EVENT,
      kind: "exposure",
      experiment: "e",
      variant: "v",
      metric: null,
      value: null,
      bucket: null,
      bucketCount: 10_000,
      subjectHash: "abc",
      environment: "test",
      timestamp: "2025-01-01T00:00:00.000Z",
    })
    expect(spy).toHaveBeenCalledOnce()
  })

  it("createJsonlFileSink appends one JSON line per event and flushes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-analytics-"))
    const file = join(dir, "events.jsonl")
    try {
      const sink = createJsonlFileSink(file)
      const event: ExperimentEvent = {
        event: EXPERIMENT_EXPOSURE_EVENT,
        kind: "exposure",
        experiment: "e",
        variant: "v",
        metric: null,
        value: null,
        bucket: null,
        bucketCount: 10_000,
        subjectHash: "abc123",
        environment: "test",
        timestamp: "2025-01-01T00:00:00.000Z",
      }
      sink.record(event)
      sink.record(event)
      await sink.flush?.()

      const lines = readFileSync(file, "utf8").trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0])).toMatchObject({ experiment: "e", subjectHash: "abc123" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("flushExperimentAnalytics drains the active sink", async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    setExperimentAnalyticsSink({ record: () => {}, flush })
    await flushExperimentAnalytics()
    expect(flush).toHaveBeenCalledOnce()
  })
})
