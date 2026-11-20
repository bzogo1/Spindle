/**
 * Ready-made sinks for Core Web Vitals reports.
 *
 * All sinks are best-effort: failures are swallowed because telemetry must
 * never break or delay the app. `node:fs` is loaded lazily inside the JSONL
 * sink so this module stays safe to import from client bundles — the console
 * and beacon sinks are the browser-usable ones. The batching/error-handling
 * shape mirrors `src/lib/feature-flags/analytics/sinks.ts`.
 */

import type { VitalsMetric, VitalsSink } from "./types"

/**
 * Development sink: one `console.debug` line per metric. Pair with
 * `initWebVitals`, which only installs it outside production.
 */
export function createConsoleVitalsSink(prefix = "[web-vitals]"): VitalsSink {
  return {
    record(metric) {
      console.debug(prefix, JSON.stringify(metric))
    },
  }
}

export interface BeaconVitalsSinkOptions {
  /**
   * Metrics buffered before an automatic send. Default 10 — a page load
   * produces at most 5, so in practice everything goes out on `flush()`
   * (wired to `pagehide` by `initWebVitals`).
   */
  batchSize?: number
  /**
   * Extra headers for the `fetch` fallback only — `navigator.sendBeacon`
   * cannot set headers. Default `content-type: application/json` is always
   * sent on the fetch path.
   */
  headers?: Record<string, string>
}

function beaconPayload(metrics: readonly VitalsMetric[]): string {
  return JSON.stringify({ metrics })
}

/**
 * Ships metrics to `url` as `{ metrics: [...] }`. Prefers
 * `navigator.sendBeacon` (survives page unload, which is exactly when the
 * LCP/CLS/INP metrics finalize) and falls back to `fetch` with `keepalive`.
 * Safe in browsers; network failures are swallowed.
 */
export function createBeaconVitalsSink(
  url: string,
  options: BeaconVitalsSinkOptions = {},
): VitalsSink {
  const batchSize = Math.max(1, options.batchSize ?? 10)

  let buffer: VitalsMetric[] = []
  let inFlight: Promise<void> = Promise.resolve()

  async function post(metrics: readonly VitalsMetric[]): Promise<void> {
    if (metrics.length === 0) return
    const body = beaconPayload(metrics)

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([body], { type: "application/json" })
        if (navigator.sendBeacon(url, blob)) return
      } catch {
        // Fall through to fetch.
      }
    }

    if (typeof fetch !== "function") return

    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body,
        keepalive: true,
      })
    } catch {
      // Best-effort: dropped telemetry must never surface to callers.
    }
  }

  function drain(): Promise<void> {
    const batch = buffer
    buffer = []
    inFlight = inFlight.then(() => post(batch))
    return inFlight
  }

  return {
    record(metric) {
      buffer.push(metric)
      if (buffer.length >= batchSize) void drain()
    },
    flush() {
      return drain()
    },
  }
}

export interface JsonlVitalsSinkOptions {
  /**
   * Called when a write fails permanently. Returning a different string is
   * treated as a replacement path once — useful for falling back to a tmp
   * dir. Default: give up silently.
   */
  onError?: (error: unknown, filePath: string) => string | void
}

type FsPromises = typeof import("node:fs/promises")

let fsModule: Promise<FsPromises> | null = null

function loadFs(): Promise<FsPromises> {
  fsModule ??= import("node:fs/promises")
  return fsModule
}

/**
 * Appends one JSON object per line to `filePath`. Server-only in practice —
 * the `node:fs/promises` import is lazy but still requires Node. Writes are
 * serialised on a promise chain so concurrent `record()` calls keep line
 * order; `flush()` resolves once the chain drains.
 */
export function createJsonlVitalsSink(
  filePath: string,
  options: JsonlVitalsSinkOptions = {},
): VitalsSink {
  let activePath = filePath
  let writeChain: Promise<void> = Promise.resolve()
  let gaveUp = false

  async function writeLine(line: string): Promise<void> {
    const fs = await loadFs()
    await fs.appendFile(activePath, line, "utf8")
  }

  function enqueue(line: string): void {
    if (gaveUp) return
    writeChain = writeChain.then(async () => {
      try {
        await writeLine(line)
      } catch (error) {
        const fallback = options.onError?.(error, activePath)
        if (typeof fallback === "string" && fallback !== activePath) {
          activePath = fallback
          try {
            await writeLine(line)
          } catch {
            gaveUp = true
          }
          return
        }
        gaveUp = true
      }
    })
    // Keep the chain alive after a failure so later events still write.
    writeChain = writeChain.catch(() => {})
  }

  return {
    record(metric) {
      enqueue(`${JSON.stringify(metric)}\n`)
    },
    flush() {
      return writeChain
    },
  }
}
