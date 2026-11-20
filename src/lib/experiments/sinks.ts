/**
 * Ready-made experiment-analytics sinks.
 *
 * All sinks are best-effort: failures are swallowed (analytics must never
 * break assignment). `node:fs` is loaded lazily inside the JSONL sink so
 * this module stays safe to import from client bundles — only the console
 * sink is usable in the browser. For HTTP shipping, either reuse the
 * `createHttpSink` pattern from `src/lib/feature-flags/analytics/sinks.ts`
 * or POST the same `ExperimentEvent` shape.
 */

import type { ExperimentAnalyticsSink, ExperimentEvent } from "./analytics"

/**
 * Development sink: one `console.debug` line per event. This is also the
 * recorder's default behaviour in non-production environments.
 */
export function createConsoleSink(): ExperimentAnalyticsSink {
  return {
    record(event) {
      console.debug("[experiment-analytics]", JSON.stringify(event))
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
 * promise chain so concurrent `record()` calls keep line order. Server-only
 * in practice — the `node:fs/promises` import is lazy but still requires
 * Node.
 */
export function createJsonlFileSink(
  filePath: string,
  options: JsonlSinkOptions = {},
): ExperimentAnalyticsSink {
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
    record(event: ExperimentEvent) {
      enqueue(`${JSON.stringify(event)}\n`)
    },
    flush() {
      return writeChain
    },
  }
}
