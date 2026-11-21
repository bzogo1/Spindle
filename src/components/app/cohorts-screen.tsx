"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { QueryState, type QueryStatus } from "@/components/app/states/query-state"
import { formatDate } from "@/components/app/format"
import type { CohortCell, CohortReport, CohortRow } from "@/lib/cohorts"

/**
 * Cohort retention screen — signup-week cohorts × weekly activity grid.
 *
 * Fetches GET /api/cohorts on mount. Pass `report` to render a known report
 * directly (tests, or a future server-rendered payload). The API currently
 * serves synthetic demo users — the "Demo data" badge and the report's own
 * `note` keep that honest in the UI.
 */
export function CohortsScreen({ report }: { report?: CohortReport }) {
  const [status, setStatus] = useState<QueryStatus>(report ? "success" : "loading")
  const [data, setData] = useState<CohortReport | undefined>(report)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (report) return
    setStatus("loading")
    setError(null)
    try {
      const response = await fetch("/api/cohorts", { headers: { accept: "application/json" } })
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean
        report?: CohortReport
      } | null
      if (!response.ok || !body?.ok || !body.report) {
        throw new Error("Cohort report is unavailable.")
      }
      setData(body.report)
      setStatus("success")
    } catch (err) {
      setError(err)
      setStatus("error")
    }
  }, [report])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {data ? (
          <>
            <Badge variant="secondary" size="sm">
              Demo data
            </Badge>
            <p className="text-muted-foreground text-sm">
              {data.totals.users} demo users · {data.totals.activeThisWeek} active in the latest
              complete week
            </p>
          </>
        ) : null}
      </div>

      <QueryState<CohortReport>
        status={status}
        data={data}
        error={error}
        isEmpty={data ? data.cohorts.length === 0 : false}
        onRetry={() => void load()}
        emptyTitle="No cohort data yet"
        emptyBody="Once users start signing up and generating activity, weekly retention cohorts will appear here."
        errorTitle="Cohorts did not load"
        errorMessage="We could not load the cohort report. Try again in a moment."
      >
        {(reportData) => <CohortMatrix report={reportData} />}
      </QueryState>
    </div>
  )
}

function retentionColor(retention: number | null): string {
  if (retention === null) return "transparent"
  // Green scale: 0% → faint, 100% → strong. Alpha keeps text readable.
  const alpha = 0.12 + retention * 0.55
  return `hsl(152 60% 42% / ${alpha.toFixed(2)})`
}

function formatPercent(value: number | null): string {
  if (value === null) return "—"
  return `${Math.round(value * 100)}%`
}

interface CellFocusHandlers {
  tabIndex: number
  onFocus: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

function CellTooltip({
  cell,
  cohortSize,
  rowIndex,
  focus,
}: {
  cell: CohortCell
  cohortSize: number
  rowIndex: number
  focus: CellFocusHandlers
}) {
  const weekLabel = formatDate(cell.weekStart)
  const content = cell.complete
    ? `Week of ${weekLabel}: ${cell.activeUsers} of ${cohortSize} users active (${formatPercent(
        cell.retention,
      )})`
    : `Week of ${weekLabel}: in progress — ${cell.activeUsers} active so far`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Roving tabindex: only one grid cell is in the tab order at a time;
            arrow keys move between cells (see CohortMatrix). */}
        <td
          tabIndex={focus.tabIndex}
          onFocus={focus.onFocus}
          onKeyDown={focus.onKeyDown}
          data-cohort-cell={`${rowIndex}-${cell.week}`}
          className="p-0 text-center"
        >
          <div
            className="px-2 py-1.5 text-xs tabular-nums"
            style={{ backgroundColor: retentionColor(cell.retention) }}
          >
            {cell.complete ? formatPercent(cell.retention) : `${cell.activeUsers}*`}
          </div>
        </td>
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
}

function CohortMatrix({ report }: { report: CohortReport }) {
  // Roving tabindex for the heatmap grid: the cells carry per-cell tooltips,
  // so they must stay keyboard-reachable — but a tab stop per cell would add
  // ~cohorts×weeks stops. Instead exactly one cell is tabbable and arrow
  // keys (plus Home/End) move focus within the grid.
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)
  const rowCount = report.cohorts.length
  const colCount = report.weeks

  const focusCell = useCallback(
    (row: number, col: number) => {
      const r = Math.max(0, Math.min(row, rowCount - 1))
      const c = Math.max(0, Math.min(col, colCount - 1))
      if (r < 0 || c < 0) return
      setActiveCell({ row: r, col: c })
      bodyRef.current?.querySelector<HTMLElement>(`[data-cohort-cell="${r}-${c}"]`)?.focus()
    },
    [rowCount, colCount],
  )

  const cellKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, row: number, col: number) => {
      let next: [number, number] | null
      switch (event.key) {
        case "ArrowRight":
          next = [row, col + 1]
          break
        case "ArrowLeft":
          next = [row, col - 1]
          break
        case "ArrowDown":
          next = [row + 1, col]
          break
        case "ArrowUp":
          next = [row - 1, col]
          break
        case "Home":
          next = [row, 0]
          break
        case "End":
          next = [row, colCount - 1]
          break
        default:
          return
      }
      event.preventDefault()
      focusCell(next[0], next[1])
    },
    [colCount, focusCell],
  )

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">{report.note}</p>
      <TooltipProvider>
        <Table aria-label="Signup-week cohort retention heatmap">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Signup week</TableHead>
              <TableHead scope="col" className="text-right">
                Users
              </TableHead>
              {Array.from({ length: report.weeks }, (_, w) => (
                <TableHead key={w} scope="col" className="text-center">
                  W{w}
                </TableHead>
              ))}
              <TableHead scope="col" className="text-right">
                Inactive latest wk
              </TableHead>
              <TableHead scope="col" className="text-right">
                Avg active wks
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {report.cohorts.map((cohort: CohortRow, rowIndex) => (
              <TableRow key={cohort.weekStart}>
                <TableCell className="font-medium whitespace-nowrap">
                  {cohort.label}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {formatDate(cohort.weekStart)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{cohort.size}</TableCell>
                {cohort.cells.map((cell) => {
                  const isTabbable = activeCell
                    ? activeCell.row === rowIndex && activeCell.col === cell.week
                    : rowIndex === 0 && cell.week === 0
                  return (
                    <CellTooltip
                      key={cell.week}
                      cell={cell}
                      cohortSize={cohort.size}
                      rowIndex={rowIndex}
                      focus={{
                        tabIndex: isTabbable ? 0 : -1,
                        onFocus: () => setActiveCell({ row: rowIndex, col: cell.week }),
                        onKeyDown: (event) => cellKeyDown(event, rowIndex, cell.week),
                      }}
                    />
                  )
                })}
                <TableCell className="text-right tabular-nums">
                  {cohort.inactiveLatestWeek}
                  <span className="text-muted-foreground text-xs"> / {cohort.size}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {cohort.avgActiveWeeks.toFixed(1)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TooltipProvider>
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Users className="size-3.5" aria-hidden />
        Cells show the share of each signup-week cohort still active N weeks later. Incomplete weeks
        show a raw count with * — hover or focus a cell for details; use the arrow keys to move
        between cells.
      </p>
    </div>
  )
}
