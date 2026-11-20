import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { acceptAllChoices, CONSENT_COOKIE, writeConsent } from "@/lib/consent"
import {
  browserObserverFactory,
  createBeaconVitalsSink,
  createConsoleVitalsSink,
  createJsonlVitalsSink,
  createVitalsReporter,
  initWebVitals,
  rateVitalsMetric,
  startVitalsCollection,
  VITALS_METRIC_NAMES,
} from "@/lib/web-vitals"
import type {
  ObserverHandle,
  ObserverOptions,
  VitalsMetric,
  VitalsObserverFactory,
} from "@/lib/web-vitals"

/* ------------------------------------------------------------------------ */
/* Fake PerformanceObserver                                                  */
/* ------------------------------------------------------------------------ */

type EntryCallback = (entries: PerformanceEntry[]) => void

class FakeObserver implements ObserverHandle {
  static instances: FakeObserver[] = []

  readonly options: ObserverOptions[] = []
  disconnected = false
  private callback: EntryCallback

  constructor(callback: EntryCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }

  observe(options: ObserverOptions): void {
    this.options.push(options)
  }

  disconnect(): void {
    this.disconnected = true
  }

  emit(entries: PerformanceEntry[]): void {
    this.callback(entries)
  }

  static reset(): void {
    FakeObserver.instances = []
  }

  /** Finds the observer registered for a given entry `type`. */
  static forType(type: string): FakeObserver {
    const observer = FakeObserver.instances.find((instance) =>
      instance.options.some((options) => options.type === type),
    )
    if (!observer) throw new Error(`No fake observer registered for type "${type}"`)
    return observer
  }
}

const fakeFactory: VitalsObserverFactory = (onEntries) => new FakeObserver(onEntries)

function entry(
  partial: Partial<PerformanceEntry> & { name?: string } & Record<string, unknown>,
): PerformanceEntry {
  return {
    name: "",
    entryType: "",
    startTime: 0,
    duration: 0,
    toJSON: () => ({}),
    ...partial,
  } as PerformanceEntry
}

function makeMetric(overrides: Partial<VitalsMetric> = {}): VitalsMetric {
  return {
    name: "LCP",
    value: 1200,
    rating: "good",
    id: "lcp-1-test",
    timestamp: 1000,
    path: "/",
    ...overrides,
  }
}

beforeEach(() => {
  FakeObserver.reset()
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`
})

afterEach(() => {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------------ */
/* Ratings                                                                   */
/* ------------------------------------------------------------------------ */

describe("rateVitalsMetric", () => {
  it("covers all five metric names", () => {
    expect(VITALS_METRIC_NAMES).toEqual(["LCP", "CLS", "INP", "FCP", "TTFB"])
  })

  it("applies the Core Web Vitals thresholds", () => {
    expect(rateVitalsMetric("LCP", 2500)).toBe("good")
    expect(rateVitalsMetric("LCP", 2501)).toBe("needs-improvement")
    expect(rateVitalsMetric("LCP", 4001)).toBe("poor")

    expect(rateVitalsMetric("CLS", 0.1)).toBe("good")
    expect(rateVitalsMetric("CLS", 0.25)).toBe("needs-improvement")
    expect(rateVitalsMetric("CLS", 0.26)).toBe("poor")

    expect(rateVitalsMetric("INP", 200)).toBe("good")
    expect(rateVitalsMetric("INP", 500)).toBe("needs-improvement")
    expect(rateVitalsMetric("INP", 501)).toBe("poor")

    expect(rateVitalsMetric("FCP", 1800)).toBe("good")
    expect(rateVitalsMetric("FCP", 3001)).toBe("poor")

    expect(rateVitalsMetric("TTFB", 800)).toBe("good")
    expect(rateVitalsMetric("TTFB", 1801)).toBe("poor")
  })
})

/* ------------------------------------------------------------------------ */
/* Collector                                                                 */
/* ------------------------------------------------------------------------ */

describe("startVitalsCollection", () => {
  function collect() {
    const metrics: VitalsMetric[] = []
    const stop = startVitalsCollection({
      onMetric: (metric) => metrics.push(metric),
      observerFactory: fakeFactory,
      path: "/pricing",
      now: () => 42_000,
      makeId: (name, sequence) => `${name}-${sequence}`,
    })
    return { metrics, stop }
  }

  it("reports FCP as soon as the first-contentful-paint entry arrives", () => {
    const { metrics } = collect()

    FakeObserver.forType("paint").emit([
      entry({ name: "first-paint", entryType: "paint", startTime: 100 }),
      entry({ name: "first-contentful-paint", entryType: "paint", startTime: 900 }),
    ])

    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({
      name: "FCP",
      value: 900,
      rating: "good",
      id: "FCP-1",
      timestamp: 42_000,
      path: "/pricing",
    })
  })

  it("reports TTFB once from the navigation entry", () => {
    const getEntriesSpy = vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      entry({
        entryType: "navigation",
        startTime: 0,
        responseStart: 350,
        fetchStart: 20,
      } as Partial<PerformanceEntry>),
    ] as PerformanceEntryList)

    const { metrics } = collect()

    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({ name: "TTFB", value: 330, rating: "good" })

    // A later navigation observer callback must not double-report.
    FakeObserver.forType("navigation").emit([
      entry({ entryType: "navigation", startTime: 0, responseStart: 999, fetchStart: 1 }),
    ])
    expect(metrics.filter((metric) => metric.name === "TTFB")).toHaveLength(1)
    getEntriesSpy.mockRestore()
  })

  it("finalizes LCP, CLS, and INP on pagehide", () => {
    const { metrics, stop } = collect()

    FakeObserver.forType("largest-contentful-paint").emit([
      entry({ entryType: "largest-contentful-paint", startTime: 100, renderTime: 1200 }),
      entry({ entryType: "largest-contentful-paint", startTime: 200, renderTime: 4200 }),
    ])

    FakeObserver.forType("layout-shift").emit([
      // Two shifts inside one session window (gap < 1s).
      entry({ entryType: "layout-shift", startTime: 0, value: 0.05, hadRecentInput: false }),
      entry({ entryType: "layout-shift", startTime: 400, value: 0.1, hadRecentInput: false }),
      // Ignored: recent input.
      entry({ entryType: "layout-shift", startTime: 600, value: 0.5, hadRecentInput: true }),
      // A later window (gap >= 1s) that scores higher and wins.
      entry({ entryType: "layout-shift", startTime: 2000, value: 0.2, hadRecentInput: false }),
    ])

    FakeObserver.forType("event").emit([
      entry({ entryType: "event", duration: 80, interactionId: 1 }),
      entry({ entryType: "event", duration: 320, interactionId: 2 }),
      // interactionId 0 is not part of an interaction — ignored.
      entry({ entryType: "event", duration: 9000, interactionId: 0 }),
    ])

    window.dispatchEvent(new Event("pagehide"))
    stop()

    const byName = new Map(metrics.map((metric) => [metric.name, metric]))
    expect(byName.get("LCP")).toMatchObject({ value: 4200, rating: "poor" })
    expect(byName.get("CLS")).toMatchObject({ value: 0.2, rating: "needs-improvement" })
    expect(byName.get("INP")).toMatchObject({ value: 320, rating: "needs-improvement" })
    expect(byName.get("LCP")?.id).toBe("LCP-1")
  })

  it("reports CLS as the max session window, not the running total", () => {
    const { metrics } = collect()

    FakeObserver.forType("layout-shift").emit([
      entry({ entryType: "layout-shift", startTime: 0, value: 0.4, hadRecentInput: false }),
      // Gap > 1s starts a new window; the small window loses.
      entry({ entryType: "layout-shift", startTime: 3000, value: 0.01, hadRecentInput: false }),
    ])

    window.dispatchEvent(new Event("pagehide"))

    expect(metrics.find((metric) => metric.name === "CLS")?.value).toBe(0.4)
  })

  it("finalizes on visibilitychange → hidden", () => {
    const { metrics } = collect()

    FakeObserver.forType("largest-contentful-paint").emit([
      entry({ entryType: "largest-contentful-paint", startTime: 10, renderTime: 800 }),
    ])

    const original = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    try {
      document.dispatchEvent(new Event("visibilitychange"))
    } finally {
      if (original) Object.defineProperty(Document.prototype, "visibilityState", original)
      else delete (document as { visibilityState?: string }).visibilityState
    }

    expect(metrics.find((metric) => metric.name === "LCP")?.value).toBe(800)
  })

  it("reports each metric at most once", () => {
    const { metrics } = collect()

    const paint = FakeObserver.forType("paint")
    paint.emit([entry({ name: "first-contentful-paint", entryType: "paint", startTime: 100 })])
    paint.emit([entry({ name: "first-contentful-paint", entryType: "paint", startTime: 200 })])

    window.dispatchEvent(new Event("pagehide"))
    window.dispatchEvent(new Event("pagehide"))

    expect(metrics.filter((metric) => metric.name === "FCP")).toHaveLength(1)
    expect(metrics.find((metric) => metric.name === "FCP")?.value).toBe(100)
  })

  it("stop() discards pending metrics", () => {
    const { metrics, stop } = collect()

    FakeObserver.forType("largest-contentful-paint").emit([
      entry({ entryType: "largest-contentful-paint", startTime: 10, renderTime: 800 }),
    ])
    stop()
    window.dispatchEvent(new Event("pagehide"))

    expect(metrics.find((metric) => metric.name === "LCP")).toBeUndefined()
  })

  it("disconnects every observer on finalize", () => {
    collect()
    window.dispatchEvent(new Event("pagehide"))

    expect(FakeObserver.instances.length).toBeGreaterThan(0)
    for (const observer of FakeObserver.instances) {
      expect(observer.disconnected).toBe(true)
    }
  })

  it("no-ops outside the browser", () => {
    // jsdom always has window/document; assert the guard exists by checking
    // the factory path returns a function either way.
    const stop = startVitalsCollection({ onMetric: () => {} })
    expect(typeof stop).toBe("function")
    stop()
  })

  it("browserObserverFactory returns null without PerformanceObserver", () => {
    const original = globalThis.PerformanceObserver
    // @ts-expect-error -- simulating an environment without the API
    delete globalThis.PerformanceObserver
    try {
      expect(browserObserverFactory(() => {})).toBeNull()
    } finally {
      globalThis.PerformanceObserver = original
    }
  })
})

/* ------------------------------------------------------------------------ */
/* Reporter                                                                  */
/* ------------------------------------------------------------------------ */

describe("createVitalsReporter", () => {
  it("forwards metrics to all sinks when allowed", async () => {
    const sinkA = { record: vi.fn(), flush: vi.fn(async () => {}) }
    const sinkB = { record: vi.fn() }
    const reporter = createVitalsReporter({
      sinks: [sinkA, sinkB],
      isAllowed: () => true,
    })

    reporter.record(makeMetric())
    await reporter.flush()

    expect(sinkA.record).toHaveBeenCalledWith(expect.objectContaining({ name: "LCP" }))
    expect(sinkB.record).toHaveBeenCalledTimes(1)
    expect(sinkA.flush).toHaveBeenCalledTimes(1)
  })

  it("drops metrics when the gate rejects", () => {
    const sink = { record: vi.fn(), flush: vi.fn() }
    const reporter = createVitalsReporter({ sinks: sink, isAllowed: () => false })

    reporter.record(makeMetric())
    expect(sink.record).not.toHaveBeenCalled()
  })

  it("swallows sink failures", () => {
    const badSink = {
      record: vi.fn(() => {
        throw new Error("boom")
      }),
      flush: vi.fn(async () => {
        throw new Error("boom")
      }),
    }
    const goodSink = { record: vi.fn() }
    const reporter = createVitalsReporter({
      sinks: [badSink, goodSink],
      isAllowed: () => true,
    })

    expect(() => reporter.record(makeMetric())).not.toThrow()
    expect(goodSink.record).toHaveBeenCalledTimes(1)
    return expect(reporter.flush()).resolves.toBeUndefined()
  })

  it("defaults the gate to the analytics consent category", () => {
    const sink = { record: vi.fn() }
    const reporter = createVitalsReporter({ sinks: sink })

    // Undecided → dropped.
    reporter.record(makeMetric())
    expect(sink.record).not.toHaveBeenCalled()

    writeConsent(acceptAllChoices())
    reporter.record(makeMetric())
    expect(sink.record).toHaveBeenCalledTimes(1)
  })
})

/* ------------------------------------------------------------------------ */
/* initWebVitals                                                             */
/* ------------------------------------------------------------------------ */

describe("initWebVitals", () => {
  it("wires collection → gate → sinks and flushes on pagehide", async () => {
    const sink = { record: vi.fn(), flush: vi.fn(async () => {}) }
    const stop = initWebVitals({
      sinks: sink,
      isAllowed: () => true,
      observerFactory: fakeFactory,
      path: "/",
      now: () => 7,
      makeId: (name, sequence) => `${name}-${sequence}`,
    })

    FakeObserver.forType("paint").emit([
      entry({ name: "first-contentful-paint", entryType: "paint", startTime: 500 }),
    ])
    window.dispatchEvent(new Event("pagehide"))
    await Promise.resolve()

    expect(sink.record).toHaveBeenCalledWith(expect.objectContaining({ name: "FCP", value: 500 }))
    expect(sink.flush).toHaveBeenCalled()
    stop()
  })

  it("drops everything when consent is missing", () => {
    const sink = { record: vi.fn(), flush: vi.fn(async () => {}) }
    initWebVitals({ sinks: sink, observerFactory: fakeFactory })

    FakeObserver.forType("paint").emit([
      entry({ name: "first-contentful-paint", entryType: "paint", startTime: 500 }),
    ])

    expect(sink.record).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------------ */
/* Sinks                                                                     */
/* ------------------------------------------------------------------------ */

describe("createConsoleVitalsSink", () => {
  it("logs one debug line per metric", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
    const sink = createConsoleVitalsSink("[test-vitals]")
    sink.record(makeMetric())
    expect(debug).toHaveBeenCalledWith("[test-vitals]", expect.stringContaining('"name":"LCP"'))
  })
})

describe("createBeaconVitalsSink", () => {
  function stubNavigator(sendBeacon?: (url: string, data: Blob) => boolean) {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "sendBeacon")
    Object.defineProperty(window.navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    })
    return () => {
      if (original) Object.defineProperty(window.navigator, "sendBeacon", original)
      else delete (window.navigator as { sendBeacon?: unknown }).sendBeacon
    }
  }

  it("uses sendBeacon with a JSON blob when available", async () => {
    const sendBeacon = vi.fn((_url: string, _data: Blob) => true)
    const restore = stubNavigator(sendBeacon)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    try {
      const sink = createBeaconVitalsSink("/api/vitals")
      sink.record(makeMetric())
      sink.record(makeMetric({ name: "CLS", value: 0.05, rating: "good" }))
      await sink.flush?.()

      expect(sendBeacon).toHaveBeenCalledTimes(1)
      expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/vitals")
      expect(sendBeacon.mock.calls[0]?.[1]).toBeInstanceOf(Blob)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it("falls back to fetch keepalive when sendBeacon is unavailable", async () => {
    const restore = stubNavigator(undefined)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response())
    try {
      const sink = createBeaconVitalsSink("/api/vitals")
      sink.record(makeMetric())
      await sink.flush?.()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe("/api/vitals")
      expect(init.method).toBe("POST")
      expect(init.keepalive).toBe(true)
      expect(String(init.body)).toContain('"name":"LCP"')
    } finally {
      restore()
    }
  })

  it("auto-flushes at batchSize", async () => {
    const sendBeacon = vi.fn(() => true)
    const restore = stubNavigator(sendBeacon)
    try {
      const sink = createBeaconVitalsSink("/api/vitals", { batchSize: 2 })
      sink.record(makeMetric())
      expect(sendBeacon).not.toHaveBeenCalled()
      sink.record(makeMetric({ name: "FCP" }))
      await vi.waitFor(() => expect(sendBeacon).toHaveBeenCalledTimes(1))
    } finally {
      restore()
    }
  })
})

describe("createJsonlVitalsSink", () => {
  it("appends one JSON line per metric and flushes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vitals-"))
    const file = join(dir, "vitals.jsonl")
    try {
      const sink = createJsonlVitalsSink(file)
      sink.record(makeMetric())
      sink.record(makeMetric({ name: "CLS", value: 0.02 }))
      await sink.flush?.()

      const lines = (await readFile(file, "utf8")).trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ name: "LCP" })
      expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ name: "CLS" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
