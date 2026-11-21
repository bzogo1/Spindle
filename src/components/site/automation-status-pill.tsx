"use client"

import { useEffect, useRef, useState } from "react"

const RUN_DURATION_MS = 3000
const RUN_INTERVAL_MS = 18000

type Phase = "idle" | "running"

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function formatRelative(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/**
 * Live-updating status pill for the marketing demo cron job.
 * Cycles through idle → running → OK states and ticks a relative
 * timestamp every second so the pill never looks frozen.
 */
export function AutomationStatusPill() {
  const [now, setNow] = useState(() => Date.now())
  const [phase, setPhase] = useState<Phase>("idle")
  const [lastRunAt, setLastRunAt] = useState(() => Date.now() - 42_000)
  const runStartRef = useRef(0)

  useEffect(() => {
    const runTimer = window.setInterval(() => {
      setPhase("running")
      runStartRef.current = Date.now()
      window.setTimeout(() => {
        setPhase("idle")
        setLastRunAt(Date.now())
      }, RUN_DURATION_MS)
    }, RUN_INTERVAL_MS)

    const tick = window.setInterval(() => setNow(Date.now()), 1000)

    return () => {
      window.clearInterval(runTimer)
      window.clearInterval(tick)
    }
  }, [])

  const running = phase === "running"
  const runElapsed = running ? now - runStartRef.current : 0
  const label = running ? "Running" : "Last run OK"
  const detail = running ? formatElapsed(runElapsed) : formatRelative(now - lastRunAt)

  return (
    <span
      className={`status-pill status-pill--tiny${running ? " is-live" : ""}`}
      aria-live="polite"
    >
      <i></i> {label} · {detail}
    </span>
  )
}
