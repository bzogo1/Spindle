/**
 * Dependency-free Core Web Vitals collector.
 *
 * `web-vitals` is only a transitive dependency (via `@sentry/browser-utils`),
 * not a direct one, so this module re-implements the same measurements on top
 * of the PerformanceObserver / Performance Timeline APIs:
 *
 * - LCP: latest `largest-contentful-paint` entry's render time (falls back to
 *   loadTime, then startTime).
 * - CLS: cumulative layout shift score using the spec's session-window rules
 *   (1s gap closes a window, 5s caps it; the max window wins). Entries with
 *   `hadRecentInput` are ignored.
 * - INP: longest `event` (Event Timing) duration observed — an approximation
 *   of Interaction to Next Paint. Entries with `interactionId === 0` are not
 *   part of an interaction and are skipped. The observer uses
 *   `durationThreshold: 16` (like the `web-vitals` library) so moderately fast
 *   interactions are still seen; true INP interaction grouping is not
 *   reimplemented — the longest event duration stands in for INP.
 * - FCP: first `first-contentful-paint` paint entry.
 * - TTFB: `responseStart - fetchStart` of the navigation timing entry
 *   (full page loads only — client-side navigations have no navigation entry;
 *   use Sentry tracing for those).
 *
 * LCP/CLS/INP finalize on `pagehide` or `visibilitychange` → hidden, matching
 * the `web-vitals` library's lifecycle. FCP/TTFB report as soon as they are
 * known. Each metric reports at most once per page load.
 *
 * Everything is injectable (`observerFactory`, `now`, `makeId`) so the module
 * is testable under jsdom, which lacks a real PerformanceObserver.
 */

import { rateVitalsMetric, type VitalsMetric, type VitalsMetricName } from "./types"

export interface ObserverOptions {
  type?: string
  entryTypes?: string[]
  buffered?: boolean
  durationThreshold?: number
}

export interface ObserverHandle {
  observe(options: ObserverOptions): void
  disconnect(): void
}

export type VitalsObserverFactory = (
  onEntries: (entries: PerformanceEntry[]) => void,
) => ObserverHandle | null

/**
 * Wraps the platform `PerformanceObserver`. Returns null when the API is
 * missing (old browsers, some test environments).
 */
export const browserObserverFactory: VitalsObserverFactory = (onEntries) => {
  if (typeof PerformanceObserver !== "function") return null

  try {
    const observer = new PerformanceObserver((list) => {
      onEntries(list.getEntries())
    })
    return {
      observe: (options) => observer.observe(options as PerformanceObserverInit),
      disconnect: () => observer.disconnect(),
    }
  } catch {
    return null
  }
}

interface LcpEntry extends PerformanceEntry {
  renderTime?: number
  loadTime?: number
}

interface LayoutShiftEntry extends PerformanceEntry {
  value?: number
  hadRecentInput?: boolean
}

interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number
}

interface NavigationTimingEntry extends PerformanceEntry {
  responseStart?: number
  fetchStart?: number
}

/** CLS session window rules from the layout-shift spec. */
const CLS_SESSION_GAP_MS = 1000
const CLS_SESSION_WINDOW_MS = 5000

export interface VitalsCollectorOptions {
  /** Called once per metric, at most once per metric name per page load. */
  onMetric: (metric: VitalsMetric) => void
  /** Path stamped onto metrics; defaults to `window.location.pathname`. */
  path?: string
  /** Defaults to `browserObserverFactory`; inject a fake in tests. */
  observerFactory?: VitalsObserverFactory
  /** Defaults to `Date.now`; inject for deterministic tests. */
  now?: () => number
  /** Defaults to a `name-seq-uuid` id; inject for deterministic tests. */
  makeId?: (name: VitalsMetricName, sequence: number) => string
}

function defaultMakeId(name: VitalsMetricName, sequence: number): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${name.toLowerCase()}-${sequence.toString(36)}-${rand}`
}

function safePath(): string | undefined {
  try {
    return window.location?.pathname
  } catch {
    return undefined
  }
}

function readTtfb(): number | null {
  const perf = globalThis.performance
  if (!perf || typeof perf.getEntriesByType !== "function") return null

  const nav = perf.getEntriesByType("navigation")[0] as NavigationTimingEntry | undefined
  if (!nav || typeof nav.responseStart !== "number") return null

  const start = typeof nav.fetchStart === "number" ? nav.fetchStart : nav.startTime
  const value = nav.responseStart - start
  return Number.isFinite(value) ? value : null
}

export function startVitalsCollection(options: VitalsCollectorOptions): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {}
  }

  const factory = options.observerFactory ?? browserObserverFactory
  const now = options.now ?? (() => Date.now())
  const path = options.path ?? safePath()
  const makeId = options.makeId ?? defaultMakeId

  const reported = new Set<VitalsMetricName>()
  const handles: ObserverHandle[] = []
  let sequence = 0
  let finalized = false

  // Pending metric state.
  let lcpValue: number | null = null
  let clsSeen = false
  let clsBest = 0
  let clsWindowStart = -1
  let clsWindowValue = 0
  let clsLastTimestamp = Number.NEGATIVE_INFINITY
  let inpValue: number | null = null

  function emit(name: VitalsMetricName, rawValue: number): void {
    if (reported.has(name) || !Number.isFinite(rawValue)) return
    reported.add(name)

    // CLS is reported to four decimal places, like the web-vitals library.
    const value = name === "CLS" ? Number(rawValue.toFixed(4)) : rawValue
    options.onMetric({
      name,
      value,
      rating: rateVitalsMetric(name, value),
      id: makeId(name, ++sequence),
      timestamp: now(),
      path,
    })
  }

  function closeClsWindow(): void {
    clsBest = Math.max(clsBest, clsWindowValue)
    clsWindowValue = 0
    clsWindowStart = -1
  }

  function addLayoutShift(entry: LayoutShiftEntry): void {
    if (entry.hadRecentInput === true) return
    const shift = typeof entry.value === "number" ? entry.value : 0
    if (shift <= 0) return

    clsSeen = true
    const timestamp = entry.startTime

    // A gap >= 1s since the previous shift, or a window older than 5s, closes
    // the current session window and starts a new one.
    if (
      clsWindowStart < 0 ||
      timestamp - clsLastTimestamp >= CLS_SESSION_GAP_MS ||
      timestamp - clsWindowStart >= CLS_SESSION_WINDOW_MS
    ) {
      closeClsWindow()
      clsWindowStart = timestamp
    }

    clsWindowValue += shift
    clsLastTimestamp = timestamp
  }

  function finalizeCls(): number {
    closeClsWindow()
    return clsBest
  }

  // Registers one observer per entry type. `PerformanceObserver.observe()` can
  // only be called once per observer, so the `entryTypes` fallback gets a
  // fresh observer when the `type` form throws.
  function watch(
    type: string,
    handler: (entries: PerformanceEntry[]) => void,
    extra: ObserverOptions = {},
  ): void {
    const attempts: ObserverOptions[] = [
      { type, buffered: true, ...extra },
      { entryTypes: [type], buffered: true, ...extra },
    ]

    for (const init of attempts) {
      const handle = factory(handler)
      if (!handle) return
      try {
        handle.observe(init)
        handles.push(handle)
        return
      } catch {
        try {
          handle.disconnect()
        } catch {
          // Already unusable; ignore.
        }
      }
    }
  }

  // TTFB: read the navigation entry now (it is buffered by the time the
  // instrumentation module runs) and again via an observer as a fallback.
  const ttfb = readTtfb()
  if (ttfb !== null) emit("TTFB", ttfb)

  watch("navigation", (entries) => {
    const nav = entries[0] as NavigationTimingEntry | undefined
    if (!nav || typeof nav.responseStart !== "number") return
    const start = typeof nav.fetchStart === "number" ? nav.fetchStart : nav.startTime
    emit("TTFB", nav.responseStart - start)
  })

  watch("paint", (entries) => {
    for (const entry of entries) {
      if (entry.name === "first-contentful-paint") {
        emit("FCP", entry.startTime)
        return
      }
    }
  })

  watch("largest-contentful-paint", (entries) => {
    const latest = entries[entries.length - 1] as LcpEntry | undefined
    if (!latest) return
    lcpValue = latest.renderTime || latest.loadTime || latest.startTime
  })

  watch("layout-shift", (entries) => {
    for (const entry of entries) addLayoutShift(entry as LayoutShiftEntry)
  })

  // durationThreshold 16ms matches the web-vitals library's INP observer;
  // the ~104ms platform default would hide moderately fast interactions.
  watch(
    "event",
    (entries) => {
      for (const entry of entries) {
        const eventEntry = entry as EventTimingEntry
        // interactionId 0 means the event was not part of an interaction.
        if (eventEntry.interactionId === 0) continue
        if (inpValue === null || entry.duration > inpValue) {
          inpValue = entry.duration
        }
      }
    },
    { durationThreshold: 16 },
  )

  function finalize(): void {
    if (finalized) return
    finalized = true
    cleanup()

    if (lcpValue !== null) emit("LCP", lcpValue)
    if (clsSeen) emit("CLS", finalizeCls())
    if (inpValue !== null) emit("INP", inpValue)
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") finalize()
  }

  function cleanup(): void {
    window.removeEventListener("pagehide", finalize)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    for (const handle of handles) {
      try {
        handle.disconnect()
      } catch {
        // Disconnect is best-effort during teardown.
      }
    }
    handles.length = 0
  }

  window.addEventListener("pagehide", finalize)
  document.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    if (finalized) return
    finalized = true
    // Stopping discards pending metrics — used for teardown/HMR, not unload.
    cleanup()
  }
}
