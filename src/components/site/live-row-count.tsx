"use client"

import { useEffect, useState } from "react"

const BASE_ROWS = 48_102
const BASE_COLUMNS = 14
const TICK_MS = 2500

/**
 * CustomEvent dispatched on `window` (or the element) to freeze the live
 * count and show a final message instead — used by the vanilla-JS
 * "Run all" interaction on /lab.
 */
export const LIVE_ROW_COUNT_DONE_EVENT = "spindle:live-row-count-done"

function formatCount(value: number): string {
  return value.toLocaleString("en-US")
}

/**
 * Live-updating row count for the marketing notebook demos.
 * Simulates a stream of freshly ingested survey rows landing in the
 * loaded dataset: the count grows in small bursts on an interval until a
 * `LIVE_ROW_COUNT_DONE_EVENT` supplies a final message.
 */
export function LiveRowCount({ id }: { id?: string }) {
  const [rows, setRows] = useState(BASE_ROWS)
  const [doneMessage, setDoneMessage] = useState<string | null>(null)

  useEffect(() => {
    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (typeof detail === "string" && detail) setDoneMessage(detail)
    }
    window.addEventListener(LIVE_ROW_COUNT_DONE_EVENT, onDone)
    return () => window.removeEventListener(LIVE_ROW_COUNT_DONE_EVENT, onDone)
  }, [])

  useEffect(() => {
    if (doneMessage !== null) return
    const timer = window.setInterval(() => {
      setRows((current) => current + 1 + Math.floor(Math.random() * 9))
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [doneMessage])

  return (
    <span id={id} aria-live="polite">
      {doneMessage ?? `Loaded ${formatCount(rows)} rows × ${BASE_COLUMNS} columns`}
    </span>
  )
}
