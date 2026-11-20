"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { History, Search } from "lucide-react"

import {
  ADMIN_AUDIT_EVENT_TYPES,
  ADMIN_AUDIT_OUTCOMES,
  auditOutcomeForType,
  type AdminAuditOutcome,
  type AdminAuditStats,
} from "@/lib/admin-audit"
import type { AuthAuditEvent } from "@/lib/auth/audit"
import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Audit log" screen for `/app/admin/audit`: aggregate stat cards plus
 * a filterable, offset-paginated table of auth audit events across all users,
 * backed by `GET /api/admin/audit/stats` and `GET /api/admin/audit/events`.
 *
 * Both endpoints are admin-only and describe a bounded scan window (the
 * in-memory audit store returns at most 200 events per query), so `total`
 * and the stats reflect that window rather than all-time history.
 */

const EVENTS_API = "/api/admin/audit/events"
const STATS_API = "/api/admin/audit/stats"
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300
/** Mirrors AUDIT_SCAN_LIMIT in the API routes — the store's max list size. */
const SCAN_WINDOW_SIZE = 200

interface AuditFilters {
  type: string
  outcome: string
  user: string
  from: string
  to: string
}

const EMPTY_FILTERS: AuditFilters = { type: "", outcome: "", user: "", from: "", to: "" }

interface EventsResponse {
  ok: boolean
  events?: AuthAuditEvent[]
  total?: number
  hasMore?: boolean
  message?: string
}

interface StatsResponse {
  ok: boolean
  stats?: AdminAuditStats
  scanned?: number
  message?: string
}

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  ...ADMIN_AUDIT_EVENT_TYPES.map((type) => ({ value: type, label: type })),
]

const OUTCOME_OPTIONS = [
  { value: "", label: "All outcomes" },
  ...ADMIN_AUDIT_OUTCOMES.map((outcome) => ({
    value: outcome,
    label: outcome[0].toUpperCase() + outcome.slice(1),
  })),
]

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatPercent(rate: number | null): string {
  if (rate === null) return "—"
  return `${(rate * 100).toFixed(1)}%`
}

function outcomeBadgeVariant(outcome: AdminAuditOutcome) {
  if (outcome === "failure") return "destructive" as const
  if (outcome === "success") return "secondary" as const
  return "outline" as const
}

function eventUserLabel(event: AuthAuditEvent): string {
  return event.email ?? event.userId ?? "anonymous"
}

export function AuditScreen() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [userInput, setUserInput] = useState("")
  const [debouncedUser, setDebouncedUser] = useState("")
  // Pagination is keyed to the filter signature: when filters change the key
  // no longer matches and the effective offset falls back to 0 — no reset
  // effect or extra fetch required.
  const [page, setPage] = useState({ key: "", offset: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  const [stats, setStats] = useState<AdminAuditStats | null>(null)
  const [statsScanned, setStatsScanned] = useState(0)
  const [events, setEvents] = useState<AuthAuditEvent[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  // Debounce the user search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedUser(userInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [userInput])

  // The effective filters: the debounced user term replaces the raw input.
  const effectiveFilters: AuditFilters = { ...filters, user: debouncedUser }
  const filtersKey = JSON.stringify(effectiveFilters)
  const offset = page.key === filtersKey ? page.offset : 0

  const patchFilters = useCallback((patch: Partial<AuditFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const goToOffset = useCallback(
    (next: number) => setPage({ key: filtersKey, offset: next }),
    [filtersKey],
  )

  const queryString = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams()
      if (effectiveFilters.type) params.set("type", effectiveFilters.type)
      if (effectiveFilters.outcome) params.set("outcome", effectiveFilters.outcome)
      if (effectiveFilters.user) params.set("user", effectiveFilters.user)
      if (effectiveFilters.from) params.set("from", effectiveFilters.from)
      if (effectiveFilters.to) params.set("to", effectiveFilters.to)
      for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
      const qs = params.toString()
      return qs ? `?${qs}` : ""
    },
    // filtersKey is a stable serialization of every effectiveFilters field.
    [filtersKey],
  )

  // Stats respond to filters only (they ignore pagination server-side).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`${STATS_API}${queryString()}`, { cache: "no-store" })
        const data = (await response.json()) as StatsResponse
        if (cancelled) return
        if (response.ok && data.ok && data.stats) {
          setStats(data.stats)
          setStatsScanned(data.scanned ?? 0)
        }
      } catch {
        // Stats are supplementary; the events fetch surfaces hard errors.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [queryString, reloadKey])

  // Events page: refetches when filters, offset, or a manual retry changes.
  useEffect(() => {
    const seq = ++requestSeq.current
    setEvents(null)
    setError(null)
    void (async () => {
      try {
        const response = await fetch(
          `${EVENTS_API}${queryString({ limit: String(PAGE_SIZE), offset: String(offset) })}`,
          { cache: "no-store" },
        )
        const data = (await response.json()) as EventsResponse
        if (seq !== requestSeq.current) return
        if (!response.ok || !data.ok) {
          setError(data.message ?? "Could not load audit events.")
          setEvents([])
          return
        }
        setEvents(data.events ?? [])
        setTotal(data.total ?? 0)
        setHasMore(data.hasMore ?? false)
      } catch {
        if (seq !== requestSeq.current) return
        setError("Could not load audit events. Check your connection and try again.")
        setEvents([])
      }
    })()
  }, [queryString, offset, reloadKey])

  const loading = events === null && error === null
  const empty = events !== null && events.length === 0
  const hasActiveFilters = Object.values(effectiveFilters).some(Boolean)
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + (events?.length ?? 0), total)

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setUserInput("")
    setDebouncedUser("")
  }

  return (
    <section className="app-panel" aria-labelledby="admin-audit-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="admin-audit-heading">Authentication events</h2>
          <p>
            Sign-ins, failures, session and credential events across all users, newest first.
            Figures cover the most recent scan window, not all-time history.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedUser(userInput.trim())
            }}
          >
            <div className="relative">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input
                type="search"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                placeholder="Filter by user"
                aria-label="Filter by user"
                className="w-56 pl-8"
              />
            </div>
          </form>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-filter-type" className="text-muted-foreground text-xs">
            Event type
          </label>
          <Select
            id="audit-filter-type"
            aria-label="Event type"
            options={TYPE_OPTIONS}
            value={filters.type || null}
            onChange={(value) => patchFilters({ type: typeof value === "string" ? value : "" })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-filter-outcome" className="text-muted-foreground text-xs">
            Outcome
          </label>
          <Select
            id="audit-filter-outcome"
            aria-label="Outcome"
            options={OUTCOME_OPTIONS}
            value={filters.outcome || null}
            onChange={(value) => patchFilters({ outcome: typeof value === "string" ? value : "" })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-filter-from" className="text-muted-foreground text-xs">
            From
          </label>
          <Input
            id="audit-filter-from"
            type="date"
            value={filters.from}
            onChange={(event) => patchFilters({ from: event.target.value })}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-filter-to" className="text-muted-foreground text-xs">
            To
          </label>
          <Input
            id="audit-filter-to"
            type="date"
            value={filters.to}
            onChange={(event) => patchFilters({ to: event.target.value })}
            className="w-40"
          />
        </div>
        {hasActiveFilters ? (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {stats ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Events</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Failures</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-destructive text-2xl font-semibold">{stats.failureCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Failure rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{formatPercent(stats.failureRate)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Top user</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="truncate text-lg font-semibold">{stats.topUsers[0]?.label ?? "—"}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {error ? (
        <InlineError
          title="Audit log unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading audit events" variant="table" />
      ) : empty ? (
        <EmptyState
          icon={<History aria-hidden="true" />}
          title={hasActiveFilters ? "No matching events" : "No audit events"}
          body={
            hasActiveFilters
              ? "Nothing matches the current filters. Try widening the date range or clearing filters."
              : "Authentication events will appear here once users sign in."
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>User</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events ?? []).map((event, index) => {
                const outcome = auditOutcomeForType(event.type)
                return (
                  <TableRow key={`${event.timestamp}-${index}`}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(event.timestamp)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{event.type}</TableCell>
                    <TableCell>
                      <Badge variant={outcomeBadgeVariant(outcome)}>{outcome}</Badge>
                    </TableCell>
                    <TableCell>{eventUserLabel(event)}</TableCell>
                    <TableCell className="font-mono text-xs">{event.ip ?? "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Showing {rangeStart}–{rangeEnd} of {total}
              {statsScanned >= SCAN_WINDOW_SIZE ? " (most recent scan window)" : ""}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => goToOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasMore}
                onClick={() => goToOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
