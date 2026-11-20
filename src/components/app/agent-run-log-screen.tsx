"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Bot } from "lucide-react"

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPages,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/app/states/empty-state"
import { ScreenState } from "@/components/app/states/screen-state"
import { useAgentRunLog } from "@/lib/api"
import type { AgentRunLogEntry, AgentRunLogStatus } from "@/lib/api"

import { formatRelativeTime } from "./format"
import { AgentRunCancelButton } from "./agent-run-cancel"
import { AgentRunReplayButton } from "./agent-run-replay"
import { AgentRunShareButton } from "./agent-run-share"
import { AgentRunCompareDialog } from "./agent-run-compare-dialog"
import { AgentRunBadge, useNow } from "./agent-run-log-shared"
import {
  formatCostUsd,
  formatDurationMs,
  formatTokenCount,
  isActiveRun,
  runCostUsd,
  runDurationMs,
  runTotalTokens,
} from "./agent-run-log-utils"

/** Client-side page size for the run history list (API returns all entries). */
const AGENT_RUN_LOG_PAGE_SIZE = 10

/** Comparison is limited to two runs at a time. */
const AGENT_RUN_COMPARE_LIMIT = 2

const STATUS_FILTERS: { value: "all" | AgentRunLogStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "waiting_approval", label: "Waiting for approval" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
]

function projectOptions(runs: AgentRunLogEntry[]) {
  const seen = new Map<string, string>()
  for (const run of runs) seen.set(run.projectId, run.projectName)
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function RunRow({
  run,
  now,
  selected,
  selectionFull,
  onToggleSelect,
  onCancelled,
}: {
  run: AgentRunLogEntry
  now: number
  selected: boolean
  selectionFull: boolean
  onToggleSelect: (run: AgentRunLogEntry, checked: boolean) => void
  onCancelled: () => void
}) {
  const duration = runDurationMs(run, now)
  const costUsd = runCostUsd(run)
  return (
    <li className="app-runlog-item">
      <Checkbox
        checked={selected}
        disabled={selectionFull && !selected}
        onCheckedChange={(checked) => onToggleSelect(run, checked === true)}
        aria-label={`Select ${run.prompt} for comparison`}
        title={selectionFull && !selected ? "Select at most 2 runs to compare" : undefined}
      />
      <Link href={`/app/agent/${run.id}`} className="app-run-row app-runlog-row">
        <span
          className={`app-status-dot is-${run.status}${isActiveRun(run.status) ? "is-live" : ""}`}
          aria-hidden="true"
        />
        <span className="app-run-main">
          <strong>{run.prompt}</strong>
          <small>
            {run.projectName} · {run.actor.name} · {formatRelativeTime(run.createdAt, now)}
          </small>
        </span>
        <span className="app-run-meta">
          <AgentRunBadge status={run.status} />
          <span>{duration === null ? "—" : formatDurationMs(duration)}</span>
          <span className="app-runlog-cost" title="Reported run cost">
            {costUsd === null ? "—" : formatCostUsd(costUsd)}
          </span>
        </span>
      </Link>
      <AgentRunCancelButton run={run} onCancelled={onCancelled} label="Cancel" />
      <AgentRunReplayButton run={run} label="Replay" />
      <AgentRunShareButton run={run} label="Copy link" />
    </li>
  )
}

export function AgentRunLogScreen() {
  const query = useAgentRunLog()
  const [projectFilter, setProjectFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<"all" | AgentRunLogStatus>("all")

  const runs = query.data ?? []
  const hasActiveRun = runs.some((run) => isActiveRun(run.status))
  const now = useNow(hasActiveRun ? 1000 : 30_000)

  const projects = useMemo(() => projectOptions(runs), [runs])

  const filtered = useMemo(
    () =>
      runs.filter(
        (run) =>
          (projectFilter === "all" || run.projectId === projectFilter) &&
          (statusFilter === "all" || run.status === statusFilter),
      ),
    [runs, projectFilter, statusFilter],
  )

  const [page, setPage] = useState(1)
  // Selected runs are stored by id with a snapshot of the entry so the
  // selection survives pagination, filtering, and refetches.
  const [selectedRuns, setSelectedRuns] = useState<Map<string, AgentRunLogEntry>>(new Map())
  const [compareOpen, setCompareOpen] = useState(false)

  const selectionFull = selectedRuns.size >= AGENT_RUN_COMPARE_LIMIT

  const toggleRunSelection = (run: AgentRunLogEntry, checked: boolean) => {
    setSelectedRuns((current) => {
      const next = new Map(current)
      if (checked) {
        if (next.size >= AGENT_RUN_COMPARE_LIMIT) return current
        next.set(run.id, run)
      } else {
        next.delete(run.id)
      }
      return next
    })
  }

  const clearSelection = () => {
    setSelectedRuns(new Map())
    setCompareOpen(false)
  }

  const compareRuns =
    selectedRuns.size === AGENT_RUN_COMPARE_LIMIT ? [...selectedRuns.values()] : null

  const pageCount = Math.max(1, Math.ceil(filtered.length / AGENT_RUN_LOG_PAGE_SIZE))
  // Clamp instead of resetting: filter changes shrink the list, which shifts
  // page contents but must not yank the user back to page 1 (or crash when
  // the current page falls out of range).
  const currentPage = Math.min(page, pageCount)

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const pageStart = filtered.length === 0 ? 0 : (currentPage - 1) * AGENT_RUN_LOG_PAGE_SIZE + 1
  const pageEnd = Math.min(currentPage * AGENT_RUN_LOG_PAGE_SIZE, filtered.length)
  const pageItems = filtered.slice(pageStart - 1, pageEnd)

  // Cost rollup across the filtered runs; only counts runs that reported usage.
  const usageRuns = filtered.filter((run) => run.usage !== undefined)
  const totalCostUsd = usageRuns.reduce((sum, run) => sum + (runCostUsd(run) ?? 0), 0)
  const totalTokens = usageRuns.reduce((sum, run) => sum + (runTotalTokens(run) ?? 0), 0)

  return (
    <ScreenState
      screen="agent"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(entries) => (
        <div className="app-page">
          <div className="app-page-head">
            <div>
              <h1>Agent runs</h1>
              <p className="app-page-subtitle">
                Every agent run across {entries.length} project
                {entries.length === 1 ? "" : "s"} in this workspace. Open a run to review its
                step-by-step trace.
              </p>
            </div>
          </div>

          {entries.length === 0 ? (
            <EmptyState
              icon={<Bot aria-hidden="true" />}
              title="No agent runs yet"
              body="Runs started from a project agent page will appear here with their full trace."
            />
          ) : (
            <>
              <div className="app-toolbar app-runlog-filters">
                <label className="app-sort-field">
                  <span className="sr-only">Filter by project</span>
                  <select
                    value={projectFilter}
                    onChange={(event) => setProjectFilter(event.target.value)}
                    aria-label="Filter by project"
                  >
                    <option value="all">All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="app-sort-field">
                  <span className="sr-only">Filter by status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                    aria-label="Filter by status"
                  >
                    {STATUS_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {hasActiveRun ? (
                  <span className="app-runlog-live" role="status">
                    <span className="app-status-dot is-running is-live" aria-hidden="true" />
                    Live — durations update while runs are active
                  </span>
                ) : null}
              </div>

              {selectedRuns.size > 0 ? (
                <div className="app-runlog-compare-bar" role="region" aria-label="Run comparison">
                  <span className="app-runlog-compare-count">
                    {selectedRuns.size} of {AGENT_RUN_COMPARE_LIMIT} runs selected
                  </span>
                  <div className="app-runlog-compare-actions">
                    <button
                      type="button"
                      className="fm-btn fm-btn--solid"
                      disabled={!compareRuns}
                      onClick={() => setCompareOpen(true)}
                    >
                      Compare runs
                    </button>
                    <button type="button" className="fm-btn" onClick={clearSelection}>
                      Clear
                    </button>
                  </div>
                </div>
              ) : null}

              {filtered.length === 0 ? (
                <EmptyState
                  title="No matching runs"
                  body="No runs match the selected project and status filters."
                  primaryAction={{
                    label: "Clear filters",
                    variant: "secondary",
                    onClick: () => {
                      setProjectFilter("all")
                      setStatusFilter("all")
                    },
                  }}
                />
              ) : (
                <>
                  <ul className="app-run-list">
                    {pageItems.map((run) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        now={now}
                        selected={selectedRuns.has(run.id)}
                        selectionFull={selectionFull}
                        onToggleSelect={toggleRunSelection}
                        onCancelled={query.refetch}
                      />
                    ))}
                  </ul>

                  <div className="app-runlog-pager">
                    <div className="app-runlog-pager-counts">
                      <p className="app-runlog-pager-count">
                        Showing {pageStart}–{pageEnd} of {filtered.length}
                      </p>
                      {usageRuns.length > 0 ? (
                        <p className="app-runlog-pager-count" data-testid="runlog-cost-total">
                          {usageRuns.length} of {filtered.length} runs report usage · total cost{" "}
                          {formatCostUsd(totalCostUsd)} · {formatTokenCount(totalTokens)} tokens
                        </p>
                      ) : null}
                    </div>
                    {pageCount > 1 ? (
                      <Pagination className="mx-0 w-auto">
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              disabled={currentPage <= 1}
                              onClick={() => setPage(currentPage - 1)}
                            />
                          </PaginationItem>
                          <PaginationPages
                            pageCount={pageCount}
                            currentPage={currentPage}
                            onPageChange={setPage}
                            siblingCount={1}
                          />
                          <PaginationItem>
                            <PaginationNext
                              disabled={currentPage >= pageCount}
                              onClick={() => setPage(currentPage + 1)}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    ) : null}
                  </div>
                </>
              )}

              {compareRuns ? (
                <AgentRunCompareDialog
                  runs={compareRuns}
                  open={compareOpen}
                  onOpenChange={setCompareOpen}
                  now={now}
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </ScreenState>
  )
}
