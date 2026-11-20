/**
 * Ready-made flag-analytics sinks.
 *
 * All sinks are best-effort: failures are swallowed (analytics must never
 * break flag evaluation). `node:fs` is loaded lazily inside the JSONL sink so
 * this module stays safe to import from client bundles — only the console and
 * HTTP sinks are usable in the browser.
 */

import type { FlagAnalyticsSink, FlagExposureEvent } from "./types"

/**
 * Development sink: one `console.debug` line per event. Pair with the
 * recorder's default (silent in production) or install explicitly in dev.
 */
export function createConsoleSink(): FlagAnalyticsSink {
  return {
    record(event) {
      console.debug("[flag-analytics]", JSON.stringify(event))
    },
  }
}

type FsPromises = typeof import("node:fs/promises")

let fsModule: Promise<FsPromises> | null = null

function loadFs(): Promise<FsPromises> {
  fsModule ??= import("node:fs/promises")
  return fsModule
}

export type JsonlSinkOptions = {
  /**
   * Called when the first write fails permanently (e.g. ENOENT on a missing
   * directory, EACCES). Returning a string is treated as a replacement path
   * once — useful for falling back to a tmp dir. Default: give up silently.
   */
  onError?: (error: unknown, filePath: string) => string | void
}

/**
 * Appends one JSON object per line to `filePath`. Writes are serialised on a
 * promise chain so concurrent `record()` calls keep line order. Server-only in
 * practice — the `node:fs/promises` import is lazy but still requires Node.
 */
export function createJsonlFileSink(
  filePath: string,
  options: JsonlSinkOptions = {},
): FlagAnalyticsSink {
  let activePath = filePath
  let writeChain: Promise<void> = Promise.resolve()
  let gaveUp = false

  function enqueue(line: string) {
    if (gaveUp) return
    writeChain = writeChain.then(async () => {
      try {
        const fs = await loadFs()
        await fs.appendFile(activePath, line, "utf8")
      } catch (error) {
        const fallback = options.onError?.(error, activePath)
        if (typeof fallback === "string" && fallback !== activePath) {
          activePath = fallback
          try {
            await enqueueRetry(line)
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

  async function enqueueRetry(line: string) {
    const fs = await loadFs()
    await fs.appendFile(activePath, line, "utf8")
  }

  return {
    record(event) {
      enqueue(`${JSON.stringify(event)}\n`)
    },
    flush() {
      return writeChain
    },
  }
}

export type HttpSinkOptions = {
  /** Extra headers merged over `Content-Type: application/json`. */
  headers?: Record<string, string>
  /**
   * Events buffered before an automatic POST. Default 20. `flush()` always
   * sends whatever remains.
   */
  batchSize?: number
  /** Request timeout in ms; the fetch is aborted after this. Default 5000. */
  timeoutMs?: number
  /**
   * Wrap events in `{ events: [...] }` (default) or send a bare array.
   * Set false to send `{ event }` per record unbatched is not supported —
   * batching is always on; this only controls the envelope.
   */
  envelope?: boolean
}

/**
 * Batches events and POSTs them as JSON to `url`. Safe in browsers (uses
 * `fetch`). Network failures are swallowed; `flush()` drains the buffer.
 */
export function createHttpSink(url: string, options: HttpSinkOptions = {}): FlagAnalyticsSink {
  const batchSize = Math.max(1, options.batchSize ?? 20)
  const timeoutMs = options.timeoutMs ?? 5000
  const envelope = options.envelope ?? true

  let buffer: FlagExposureEvent[] = []
  let sending: Promise<void> = Promise.resolve()

  async function post(events: FlagExposureEvent[]) {
    if (events.length === 0) return
    const body = envelope ? JSON.stringify({ events }) : JSON.stringify(events)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body,
        keepalive: true,
        signal: controller.signal,
      })
    } catch {
      // Best-effort: dropped analytics must never surface to callers.
    } finally {
      clearTimeout(timer)
    }
  }

  function drain(): Promise<void> {
    const batch = buffer
    buffer = []
    sending = sending.then(() => post(batch))
    return sending
  }

  return {
    record(event) {
      buffer.push(event)
      if (buffer.length >= batchSize) void drain()
    },
    flush() {
      return drain()
    },
  }
}
