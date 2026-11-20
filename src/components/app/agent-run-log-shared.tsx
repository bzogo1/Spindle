"use client"

import { useEffect, useState } from "react"

import type { AgentRunLogStatus } from "@/lib/api"

import { statusLabel } from "./agent-run-log-utils"

export function AgentRunBadge({ status }: { status: AgentRunLogStatus }) {
  return <span className={`app-badge is-${status}`}>{statusLabel(status)}</span>
}

/** Re-renders every `intervalMs` while `active` so live durations stay fresh. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
