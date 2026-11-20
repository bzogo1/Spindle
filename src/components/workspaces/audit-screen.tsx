"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { History, Search } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Workspace "Audit log" screen for `/app/workspaces/[id]/audit`: a filterable,
 * offset-paginated table of workspace audit events backed by
 * `GET /api/workspaces/[id]/audit`.
 *
 * The endpoint is owner/admin only — members get a 403, which renders as a
 * friendly insufficient-permissions state instead of an error.
 */

const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

interface AuditFilters {
  since: string
  until: string
}

const EMPTY_FILTERS: AuditFilters = { since: "", until: "" }

/** Filters plus the debounced type search — the request signature. */
interface EffectiveAuditFilters extends AuditFilters {
  type: string
}

interface EventsResponse {
  ok: boolean
  events?: EnrichedWorkspaceAuditEvent[]
  total?: number
  message?: string
}

/** Mirrors the API response shape from `GET /api/workspaces/[id]/audit`. */
interface WorkspaceAuditActor {
  id: string
  name: string | null
  email: string
}

interface EnrichedWorkspaceAuditEvent {
  id: string
  workspaceId: string
  type: string
  actorId: string | null
  details: Record<string, unknown>
  createdAt: string
  actor: WorkspaceAuditActor | null
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function actorLabel(event: EnrichedWorkspaceAuditEvent): string {
  if (event.actor) return event.actor.name ?? event.actor.email
  if (event.actorId) return event.actorId
  return "system"
}

function typeBadgeVariant(type: string) {
  const lower = type.toLowerCase()
  if (lower.includes("deleted") || lower.includes("removed") || lower.includes("failed")) {
    return "destructive" as const
  }
  if (lower.includes("created") || lower.includes("added") || lower.includes("joined")) {
    return "secondary" as const
  }
  return "outline" as const
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Readable `key: value` summary of the event details blob. */
function formatDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details)
  if (entries.length === 0) return "—"
  return entries.map(([key, value]) => `${key}: ${formatDetailValue(value)}`).join("  ·  ")
}

export function WorkspaceAuditScreen({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [typeInput, setTypeInput] = useState("")
  const [debouncedType, setDebouncedType] = useState("")
  // Accumulated events for "Load more" pagination; keyed to the filter
  // signature so a filter change falls back to the first page automatically.
  const [page, setPage] = useState({ key: "", offset: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  const [events, setEvents] = useState<EnrichedWorkspaceAuditEvent[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  // Debounce the type search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedType(typeInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typeInput])

  const effectiveFilters: EffectiveAuditFilters = { ...filters, type: debouncedType }
  const filtersKey = JSON.stringify(effectiveFilters)
  const offset = page.key === filtersKey ? page.offset : 0

  const patchFilters = useCallback((patch: Partial<AuditFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const queryString = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams()
      if (effectiveFilters.type) params.set("type", effectiveFilters.type)
      if (effectiveFilters.since) params.set("since", effectiveFilters.since)
      if (effectiveFilters.until) params.set("until", effectiveFilters.until)
      for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
      const qs = params.toString()
      return qs ? `?${qs}` : ""
    },
    // filtersKey is a stable serialization of every effectiveFilters field.
    [filtersKey],
  )

  const apiUrl = `/api/workspaces/${encodeURIComponent(workspaceId)}/audit`

  // First page: refetches when filters, manual retry, or workspace changes.
  useEffect(() => {
    const seq = ++requestSeq.current
    setEvents(null)
    setError(null)
    setForbidden(false)
    setLoadingMore(false)
    void (async () => {
      try {
        const response = await fetch(
          `${apiUrl}${queryString({ limit: String(PAGE_SIZE), offset: "0" })}`,
          { cache: "no-store" },
        )
        const data = (await response.json()) as EventsResponse
        if (seq !== requestSeq.current) return
        if (response.status === 403) {
          setForbidden(true)
          setEvents([])
          return
        }
        if (!response.ok || !data.ok) {
          setError(data.message ?? "Could not load the audit log.")
          setEvents([])
          return
        }
        setEvents(data.events ?? [])
        setTotal(data.total ?? 0)
        setPage({ key: filtersKey, offset: (data.events ?? []).length })
      } catch {
        if (seq !== requestSeq.current) return
        setError("Could not load the audit log. Check your connection and try again.")
        setEvents([])
      }
    })()
  }, [apiUrl, queryString, filtersKey, reloadKey])

  const loadMore = useCallback(() => {
    const seq = requestSeq.current
    setLoadingMore(true)
    void (async () => {
      try {
        const response = await fetch(
          `${apiUrl}${queryString({ limit: String(PAGE_SIZE), offset: String(offset) })}`,
          { cache: "no-store" },
        )
        const data = (await response.json()) as EventsResponse
        if (seq !== requestSeq.current) return
        if (!response.ok || !data.ok) {
          setError(data.message ?? "Could not load more events.")
          return
        }
        const next = data.events ?? []
        setEvents((prev) => [...(prev ?? []), ...next])
        setTotal(data.total ?? 0)
        setPage({ key: filtersKey, offset: offset + next.length })
      } catch {
        if (seq !== requestSeq.current) return
        setError("Could not load more events. Check your connection and try again.")
      } finally {
        if (seq === requestSeq.current) setLoadingMore(false)
      }
    })()
  }, [apiUrl, queryString, offset, filtersKey])

  const loading = events === null && error === null && !forbidden
  // Only claim "empty" after a successful load — a failed fetch sets `error`
  // alongside `events: []`, and the InlineError already explains the missing
  // data (same suppression as users-screen / login-history-screen).
  const empty = events !== null && events.length === 0 && error === null && !forbidden
  const hasActiveFilters = Object.values(effectiveFilters).some(Boolean)
  const hasMore = events !== null && events.length < total

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setTypeInput("")
    setDebouncedType("")
  }

  if (forbidden) {
    return (
      <EmptyState
        icon={<History aria-hidden="true" />}
        title="Insufficient permissions"
        body="The workspace audit log is restricted to owners and admins. Ask a workspace owner to grant you a higher role."
      />
    )
  }

  return (
    <section className="app-panel" aria-labelledby="workspace-audit-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="workspace-audit-heading">Workspace events</h2>
          <p>Changes made by workspace members, newest first.</p>
        </div>
        <div className="app-panel-head-actions">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedType(typeInput.trim())
            }}
          >
            <div className="relative">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input
                type="search"
                value={typeInput}
                onChange={(event) => setTypeInput(event.target.value)}
                placeholder="Filter by event type"
                aria-label="Filter by event type"
                className="w-56 pl-8"
              />
            </div>
          </form>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="workspace-audit-since" className="text-muted-foreground text-xs">
            From
          </label>
          <Input
            id="workspace-audit-since"
            type="date"
            value={filters.since}
            onChange={(event) => patchFilters({ since: event.target.value })}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="workspace-audit-until" className="text-muted-foreground text-xs">
            To
          </label>
          <Input
            id="workspace-audit-until"
            type="date"
            value={filters.until}
            onChange={(event) => patchFilters({ until: event.target.value })}
            className="w-40"
          />
        </div>
        {hasActiveFilters ? (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

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
              : "Workspace events will appear here once members make changes."
          }
        />
      ) : error && !events?.length ? null : ( // Load failed with no data to show — the InlineError above covers it.
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(event.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={typeBadgeVariant(event.type)}>{event.type}</Badge>
                  </TableCell>
                  <TableCell>{actorLabel(event)}</TableCell>
                  <TableCell className="max-w-md">
                    <span className="text-muted-foreground line-clamp-2 font-mono text-xs">
                      {formatDetails(event.details)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Showing {events?.length ?? 0} of {total} events
            </p>
            {hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
