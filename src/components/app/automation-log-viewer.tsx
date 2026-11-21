"use client"

import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Filterable run-log viewer for the automations panel. Run logs are stored as
 * plain timestamped strings, so each line is classified into a level with a
 * small keyword heuristic; the level chips filter the rendered list.
 */

export type AutomationLogLevel = "info" | "warning" | "error"
export type AutomationLogFilter = "all" | AutomationLogLevel

const LEVEL_FILTERS: ReadonlyArray<{ value: AutomationLogFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
]

const ERROR_PATTERN =
  /\b(fail(?:ed|ure|s)?|error|exception|denied|unable|timed?\s*out|crash(?:ed)?)\b/i
const WARNING_PATTERN =
  /\b(warn(?:ing|ed)?|flag(?:ged)?|skipp?(?:ed)?|missing|outlier|retr(?:y|ies)|fallback|degraded|stale)\b/i

/** Classify a single log line into a display level. */
export function automationLogLevel(line: string): AutomationLogLevel {
  if (ERROR_PATTERN.test(line)) return "error"
  if (WARNING_PATTERN.test(line)) return "warning"
  return "info"
}

const LEVEL_DOT: Record<AutomationLogLevel, string> = {
  info: "bg-[var(--app-accent)]",
  warning: "bg-amber-500",
  error: "bg-[var(--ui-destructive)]",
}

const LEVEL_TEXT: Record<AutomationLogLevel, string> = {
  info: "text-[var(--app-text-muted)]",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-[var(--ui-destructive)]",
}

interface LogEntry {
  text: string
  level: AutomationLogLevel
}

export function AutomationLogViewer({
  logs,
  emptyMessage,
}: {
  logs: string[]
  /** Message shown when the active filter has no entries. */
  emptyMessage?: string
}) {
  const [filter, setFilter] = useState<AutomationLogFilter>("all")

  const entries = useMemo<LogEntry[]>(
    () => logs.map((text) => ({ text, level: automationLogLevel(text) })),
    [logs],
  )

  const counts = useMemo(() => {
    const result: Record<AutomationLogFilter, number> = {
      all: entries.length,
      info: 0,
      warning: 0,
      error: 0,
    }
    for (const entry of entries) result[entry.level] += 1
    return result
  }, [entries])

  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.level === filter)),
    [entries, filter],
  )

  if (logs.length === 0) {
    return <p className="app-automation-empty">{emptyMessage ?? "No log output for this run."}</p>
  }

  return (
    <div className="grid gap-2">
      <div
        className="app-automation-day-pills"
        role="group"
        aria-label="Filter log entries by level"
      >
        {LEVEL_FILTERS.map((option) => {
          const active = filter === option.value
          return (
            <button
              key={option.value}
              type="button"
              className={`app-automation-day-pill${active ? " is-active" : ""}`}
              aria-pressed={active}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              <span className="ml-1 tabular-nums">{counts[option.value]}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="app-automation-empty">
          {emptyMessage ?? `No ${filter} log entries for this run.`}
        </p>
      ) : (
        <ol
          className={cn(
            "m-0 grid max-h-56 list-none gap-0.5 overflow-auto p-2.5",
            "rounded-[var(--radius)] border border-[var(--app-border)]",
            "bg-[var(--app-panel-alt)] font-mono text-xs leading-6",
          )}
        >
          {visible.map((entry, index) => (
            <li key={index} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-2 inline-block size-1.5 shrink-0 rounded-full",
                  LEVEL_DOT[entry.level],
                )}
              />
              <span className={cn("min-w-0 break-words", LEVEL_TEXT[entry.level])}>
                {entry.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
