"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

export interface AutomationRunLogProps {
  /** Log lines to display, oldest first. */
  lines: string[]
  /**
   * When true the viewer reveals lines progressively (one every `intervalMs`)
   * to simulate a live stream, autoscrolling to the newest line. When false
   * all lines render immediately. Lines appended while live continue the
   * reveal without restarting it.
   */
  live?: boolean
  /** Reveal interval in ms. Defaults to 450. */
  intervalMs?: number
  className?: string
}

/**
 * Real-time automation log viewer. Finished runs render their full log;
 * in-progress runs drip-feed lines so the output looks streamed, and the
 * viewport follows the tail.
 */
export function AutomationRunLog({
  lines,
  live = false,
  intervalMs = 450,
  className,
}: AutomationRunLogProps) {
  const [visibleCount, setVisibleCount] = useState(live ? 0 : lines.length)
  const scrollRef = useRef<HTMLPreElement>(null)
  const prevRef = useRef({ live, length: lines.length })

  // Restart the reveal when the mode flips to live or the log is replaced by
  // a shorter one (a new run); appended lines just extend the stream.
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = { live, length: lines.length }
    if (!live) {
      setVisibleCount(lines.length)
    } else if (!prev.live || lines.length < prev.length) {
      setVisibleCount(0)
    }
  }, [live, lines, lines.length])

  useEffect(() => {
    if (!live || visibleCount >= lines.length) return
    const timer = window.setTimeout(() => {
      setVisibleCount((count) => Math.min(count + 1, lines.length))
    }, intervalMs)
    return () => window.clearTimeout(timer)
  }, [live, visibleCount, lines.length, intervalMs])

  // Keep the tail in view as lines stream in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleCount])

  const visible = lines.slice(0, visibleCount)
  const streaming = live && visibleCount < lines.length

  return (
    <pre
      ref={scrollRef}
      className={cn("app-automation-log max-h-56 overflow-y-auto whitespace-pre-wrap", className)}
      aria-live={live ? "polite" : undefined}
      aria-label={live ? "Live automation log" : "Automation run log"}
    >
      {visible.join("\n")}
      {streaming ? "\n▌" : ""}
    </pre>
  )
}
