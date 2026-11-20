/**
 * Consent-gated Core Web Vitals reporter and one-call initialiser.
 *
 * Reporting is gated on the `analytics` consent category from
 * `src/lib/consent.ts`: nothing reaches a sink until the visitor has
 * affirmatively allowed analytics, and a mid-session withdrawal drops
 * pending reports — the same "nothing leaves the browser" rule the Sentry
 * replay integration follows in `src/instrumentation-client.ts`. Collection
 * itself is passive (PerformanceObserver reads data the browser already
 * produces), so it is safe to run before the consent decision; only the
 * `record()` path checks the gate, which matters because the LCP/CLS/INP
 * metrics finalize on pagehide — usually after the banner has been answered.
 */

import { clientEnv } from "@/lib/env"
import { hasConsent } from "@/lib/consent"
import {
  startVitalsCollection,
  type VitalsCollectorOptions,
  type VitalsObserverFactory,
} from "./collector"
import {
  createBeaconVitalsSink,
  createConsoleVitalsSink,
  type BeaconVitalsSinkOptions,
} from "./sinks"
import type { VitalsMetric, VitalsSink } from "./types"

export interface VitalsReporterOptions {
  sinks: VitalsSink | readonly VitalsSink[]
  /**
   * Consent gate checked per metric at report time. Defaults to
   * `() => hasConsent("analytics")`.
   */
  isAllowed?: () => boolean
}

export interface VitalsReporter {
  record(metric: VitalsMetric): void
  /** Drains every sink's buffer; safe to call repeatedly. */
  flush(): Promise<void>
}

export function createVitalsReporter(options: VitalsReporterOptions): VitalsReporter {
  const sinks = Array.isArray(options.sinks) ? options.sinks : [options.sinks]
  const isAllowed = options.isAllowed ?? (() => hasConsent("analytics"))

  return {
    record(metric) {
      if (!isAllowed()) return
      for (const sink of sinks) {
        try {
          sink.record(metric)
        } catch {
          // A broken sink must never affect the app or other sinks.
        }
      }
    },
    async flush() {
      await Promise.all(
        sinks.map(async (sink) => {
          try {
            await sink.flush?.()
          } catch {
            // Best-effort drain.
          }
        }),
      )
    },
  }
}

export interface InitWebVitalsOptions {
  /**
   * Explicit sinks. When omitted: a beacon sink to `endpoint` (if given) plus
   * a console sink outside production.
   */
  sinks?: VitalsSink | readonly VitalsSink[]
  /**
   * Endpoint for the default beacon sink, e.g. `"/api/vitals"`. The route
   * does not exist yet — see `docs/performance/core-web-vitals.md`.
   */
  endpoint?: string
  beacon?: BeaconVitalsSinkOptions
  /** Overrides the default `hasConsent("analytics")` gate. */
  isAllowed?: () => boolean
  path?: string
  /** Pass-throughs for tests / advanced wiring. */
  observerFactory?: VitalsObserverFactory
  now?: VitalsCollectorOptions["now"]
  makeId?: VitalsCollectorOptions["makeId"]
}

function defaultSinks(options: InitWebVitalsOptions): VitalsSink[] {
  const sinks: VitalsSink[] = []
  if (options.endpoint) {
    sinks.push(createBeaconVitalsSink(options.endpoint, options.beacon))
  }
  if (clientEnv.NODE_ENV !== "production") {
    sinks.push(createConsoleVitalsSink())
  }
  return sinks
}

/**
 * Wires collection → consent gate → sinks in one call. Returns a teardown
 * function (also flushes sinks). Safe to call on the server — it no-ops.
 *
 * Intended wiring in `src/instrumentation-client.ts` (documented in
 * `docs/performance/core-web-vitals.md`, not applied here):
 *
 *   import { initWebVitals } from "@/lib/web-vitals"
 *   initWebVitals({ endpoint: "/api/vitals" })
 */
export function initWebVitals(options: InitWebVitalsOptions = {}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {}
  }

  const sinks = options.sinks ?? defaultSinks(options)
  const reporter = createVitalsReporter({ sinks, isAllowed: options.isAllowed })

  const stopCollect = startVitalsCollection({
    onMetric: (metric) => reporter.record(metric),
    path: options.path,
    observerFactory: options.observerFactory,
    now: options.now,
    makeId: options.makeId,
  })

  const flush = () => {
    void reporter.flush()
  }
  // The collector finalizes LCP/CLS/INP on pagehide and on
  // visibilitychange → hidden (its listener was registered first, so metrics
  // are already in the sink buffer when these run). Flushing on both events
  // sends the beacon while the page is still alive enough to transmit.
  window.addEventListener("pagehide", flush)
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    window.removeEventListener("pagehide", flush)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    stopCollect()
    void reporter.flush()
  }
}
