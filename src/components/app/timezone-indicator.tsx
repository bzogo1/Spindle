"use client"

import { useEffect, useState, type CSSProperties } from "react"
import { Clock } from "lucide-react"

import {
  detectTimeZone,
  formatDateTimeInZone,
  formatTimeInZone,
  formatUtcOffset,
} from "@/lib/timezone"

/**
 * Live clock chip showing the user's IANA zone, current local time, and UTC
 * offset — e.g. `Europe/Kyiv · 14:32 UTC+3`. Renders nothing until mounted so
 * server and client markup never disagree on the detected zone.
 *
 * Styled with the app's CSS custom properties inline because the shared
 * stylesheet is not part of this component's surface.
 */

const indicatorStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  border: "1px solid var(--app-border)",
  borderRadius: 999,
  background: "var(--app-panel)",
  color: "var(--app-text-muted)",
  fontSize: 12,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
}

const iconStyle: CSSProperties = {
  flexShrink: 0,
}

export interface TimezoneIndicatorProps {
  /** IANA zone override; defaults to the detected user zone. */
  zone?: string
  /** BCP 47 locale for time formatting; defaults to the runtime locale. */
  locale?: string
  /** Clock refresh cadence in milliseconds. Defaults to one second. */
  updateIntervalMs?: number
}

export function TimezoneIndicator({
  zone,
  locale,
  updateIntervalMs = 1000,
}: TimezoneIndicatorProps) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), updateIntervalMs)
    return () => window.clearInterval(id)
  }, [updateIntervalMs])

  if (!now) return null

  const timeZone = detectTimeZone({ resolvedTimeZone: zone })
  const time = formatTimeInZone(now, timeZone, locale)
  const offset = formatUtcOffset(timeZone, now)
  const dateTime = formatDateTimeInZone(now, timeZone, locale)

  return (
    <time
      className="app-timezone-indicator"
      style={indicatorStyle}
      dateTime={now.toISOString()}
      title={dateTime}
      aria-label={`Local time ${time} ${offset} in ${timeZone}`}
    >
      <Clock size={12} aria-hidden="true" style={iconStyle} />
      <span>{timeZone}</span>
      <span aria-hidden="true">·</span>
      <span>
        {time} {offset}
      </span>
    </time>
  )
}
