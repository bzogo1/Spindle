"use client"

import { useEffect, useState, type CSSProperties } from "react"

const DEFAULT_TOOL_COUNT = 8
const DEFAULT_REFRESH_INTERVAL_MS = 4200

type IntegrationConnectionCounterProps = {
  toolCount?: number
  refreshIntervalMs?: number
  className?: string
}

/**
 * Live connection badge for the integrations network diagram. The connected
 * tool count is stable, while the count remounts on an interval so the badge
 * gets a fresh pulse and never looks frozen.
 */
export function IntegrationConnectionCounter({
  toolCount = DEFAULT_TOOL_COUNT,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  className,
}: IntegrationConnectionCounterProps) {
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRefreshKey((key) => key + 1)
    }, refreshIntervalMs)

    return () => window.clearInterval(interval)
  }, [refreshIntervalMs])

  return (
    <div
      className={["integration-connection-counter", className].filter(Boolean).join(" ")}
      style={{ "--connection-counter-interval": `${refreshIntervalMs}ms` } as CSSProperties}
    >
      <span className="integration-connection-counter__dot" aria-hidden="true" />
      <span className="integration-connection-counter__label">
        <span key={refreshKey} className="integration-connection-counter__count">
          {toolCount}
        </span>{" "}
        tools connected
      </span>
    </div>
  )
}
