"use client"

/**
 * Upload history view — recent uploads that reached a terminal state
 * (completed / error / cancelled), newest first, with finish timestamps.
 *
 * Entries come from {@link UploadsContextValue.history}, which the provider
 * records as queue files settle. Filters narrow the list by status, date
 * range and file type (extension).
 */

import { useMemo, useState } from "react"
import { History, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { UploadHistoryEntry } from "./upload-provider"
import { useUploadsQueue } from "./upload-provider"

type StatusFilter = "all" | UploadHistoryEntry["status"]
type DateFilter = "all" | "today" | "week" | "month"

const DAY_MS = 24 * 60 * 60 * 1000

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
]

const DATE_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
]

const STATUS_LABELS: Record<UploadHistoryEntry["status"], string> = {
  completed: "Completed",
  error: "Failed",
  cancelled: "Cancelled",
}

function statusVariant(status: UploadHistoryEntry["status"]) {
  switch (status) {
    case "completed":
      return "default" as const
    case "error":
      return "destructive" as const
    default:
      return "outline" as const
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (sameDay) return `Today ${time}`
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`
}

function matchesDate(finishedAt: number, filter: DateFilter, now: number): boolean {
  switch (filter) {
    case "today": {
      const d = new Date(finishedAt)
      const n = new Date(now)
      return d.toDateString() === n.toDateString()
    }
    case "week":
      return now - finishedAt <= 7 * DAY_MS
    case "month":
      return now - finishedAt <= 30 * DAY_MS
    default:
      return true
  }
}

export interface UploadHistoryPanelProps {
  className?: string
  /** Max rows rendered (keeps the dock panel compact). */
  limit?: number
}

export function UploadHistoryPanel({ className, limit = 20 }: UploadHistoryPanelProps) {
  const { history, clearHistory } = useUploadsQueue()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [dateFilter, setDateFilter] = useState<DateFilter>("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  // File-type options derived from the extensions actually present.
  const typeOptions = useMemo(() => {
    const extensions = new Set<string>()
    for (const entry of history) {
      if (entry.extension) extensions.add(entry.extension)
    }
    return [
      { value: "all", label: "All types" },
      ...[...extensions].sort().map((ext) => ({ value: ext, label: `.${ext}` })),
    ]
  }, [history])

  const now = Date.now()
  const filtered = useMemo(
    () =>
      history.filter((entry) => {
        if (statusFilter !== "all" && entry.status !== statusFilter) return false
        if (typeFilter !== "all" && entry.extension !== typeFilter) return false
        if (!matchesDate(entry.finishedAt, dateFilter, now)) return false
        return true
      }),
    [history, statusFilter, dateFilter, typeFilter, now],
  )
  const visible = filtered.slice(0, limit)

  return (
    <section aria-label="Upload history" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          <History className="size-3.5" aria-hidden="true" />
          History
        </h3>
        {history.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={clearHistory}
          >
            <Trash2 aria-hidden="true" /> Clear
          </Button>
        ) : null}
      </div>

      {history.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            size="sm"
            aria-label="Filter by status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(value) =>
              setStatusFilter(typeof value === "string" ? (value as StatusFilter) : "all")
            }
            className="w-32"
          />
          <Select
            size="sm"
            aria-label="Filter by date"
            options={DATE_OPTIONS}
            value={dateFilter}
            onChange={(value) =>
              setDateFilter(typeof value === "string" ? (value as DateFilter) : "all")
            }
            className="w-32"
          />
          <Select
            size="sm"
            aria-label="Filter by file type"
            options={typeOptions}
            value={typeFilter}
            onChange={(value) =>
              setTypeFilter(typeof value === "string" ? value : "all")
            }
            className="w-28"
          />
        </div>
      ) : null}

      {history.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No uploads yet — finished uploads will show up here.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground text-xs">No history matches the current filters.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((entry) => (
            <li
              key={entry.id}
              className="border-border bg-card flex items-center gap-2 rounded-md border px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{entry.fileName}</p>
                <p className="text-muted-foreground text-xs">
                  {formatBytes(entry.size)} · {formatTimestamp(entry.finishedAt)}
                </p>
              </div>
              <Badge variant={statusVariant(entry.status)}>{STATUS_LABELS[entry.status]}</Badge>
            </li>
          ))}
          {filtered.length > visible.length ? (
            <li className="text-muted-foreground px-1 text-xs">
              +{filtered.length - visible.length} more — refine filters to see them.
            </li>
          ) : null}
        </ul>
      )}
    </section>
  )
}
