"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { History, RotateCcw } from "lucide-react"

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
import type { AuthAuditEvent, AuthAuditEventType } from "@/lib/auth/audit"
import { LOGIN_HISTORY_EVENT_TYPES } from "@/lib/auth/login-history"

/**
 * "Login history" panel for `/app/security/login-history`: a filterable,
 * paginated table of the signed-in user's own auth audit events (sign-ins,
 * failures, 2FA changes, session revocations, …) fetched from
 * `GET /api/auth/login-history`. The API only ever returns events attributed
 * to the caller, so this view cannot leak another user's activity.
 */

const LOGIN_HISTORY_API = "/api/auth/login-history"
const PAGE_SIZE = 50

type EventOutcome = "success" | "failure" | "info"

const EVENT_LABELS: Record<AuthAuditEventType, string> = {
  "signin.success": "Sign-in",
  "signin.failure": "Failed sign-in",
  "signin.totp_challenge": "Two-factor challenge",
  logout: "Sign-out",
  "token.refresh": "Session refresh",
  "session.revoked": "Session revoked",
  "password.reset": "Password reset",
  "email.verify": "Email verified",
  "totp.enroll": "Two-factor enabled",
  "totp.disable": "Two-factor disabled",
}

const EVENT_OUTCOME: Record<AuthAuditEventType, EventOutcome> = {
  "signin.success": "success",
  "signin.failure": "failure",
  "signin.totp_challenge": "info",
  logout: "info",
  "token.refresh": "info",
  "session.revoked": "info",
  "password.reset": "success",
  "email.verify": "success",
  "totp.enroll": "success",
  "totp.disable": "info",
}

const OUTCOME_LABEL: Record<EventOutcome, string> = {
  success: "Success",
  failure: "Failed",
  info: "Info",
}

const OUTCOME_BADGE_VARIANT: Record<EventOutcome, "secondary" | "destructive" | "outline"> = {
  success: "secondary",
  failure: "destructive",
  info: "outline",
}

interface HistoryFilters {
  type: string
  from: string
  to: string
}

const EMPTY_FILTERS: HistoryFilters = { type: "", from: "", to: "" }

interface LoginHistoryResponse {
  ok: boolean
  events?: AuthAuditEvent[]
  limit?: number
  offset?: number
  total?: number
  hasMore?: boolean
  message?: string
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

/** Humanizes a metadata `reason`/`purpose` string for display. */
function eventDetail(event: AuthAuditEvent): string | null {
  const reason = event.metadata?.reason ?? event.metadata?.purpose
  if (typeof reason !== "string" || reason.length === 0) return null
  return reason.replace(/_/g, " ")
}

function filtersActive(filters: HistoryFilters): boolean {
  return Boolean(filters.type || filters.from || filters.to)
}

function buildQuery(filters: HistoryFilters, offset: number): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  })
  if (filters.type) params.set("type", filters.type)
  if (filters.from) params.set("from", filters.from)
  if (filters.to) params.set("to", filters.to)
  return params.toString()
}

export function LoginHistoryScreen() {
  const [events, setEvents] = useState<AuthAuditEvent[] | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS)
  // Guards against out-of-order responses when filters change mid-flight.
  const requestSeq = useRef(0)

  const load = useCallback(
    async (offset: number, append: boolean) => {
      const seq = ++requestSeq.current
      if (append) setLoadingMore(true)
      else setError(null)
      try {
        const response = await fetch(`${LOGIN_HISTORY_API}?${buildQuery(filters, offset)}`, {
          cache: "no-store",
        })
        const data = (await response.json()) as LoginHistoryResponse
        if (seq !== requestSeq.current) return
        if (!response.ok || !data.ok) {
          setError(data.message ?? "Could not load login history.")
          if (!append) setEvents([])
          return
        }
        const page = data.events ?? []
        setEvents((current) => (append && current ? [...current, ...page] : page))
        setTotal(data.total ?? page.length)
        setHasMore(data.hasMore ?? false)
        setError(null)
      } catch {
        if (seq !== requestSeq.current) return
        setError("Could not load login history. Check your connection and try again.")
        if (!append) setEvents([])
      } finally {
        if (seq === requestSeq.current) setLoadingMore(false)
      }
    },
    [filters],
  )

  // (Re)load the first page whenever the filters change.
  useEffect(() => {
    void load(0, false)
  }, [load])

  function loadMore() {
    if (events) void load(events.length, true)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
  }

  const loading = events === null && error === null
  const active = filtersActive(filters)

  return (
    <section className="app-panel" aria-labelledby="login-history-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="login-history-heading">Authentication events</h2>
          <p>
            Sign-ins, failed attempts, two-factor changes, and session activity recorded for your
            account, newest first.
          </p>
        </div>
      </div>

      <div className="app-toolbar" role="group" aria-label="Login history filters">
        <label className="app-sort-field">
          <span className="sr-only">Filter by event type</span>
          <select
            value={filters.type}
            onChange={(event) =>
              setFilters((current) => ({ ...current, type: event.target.value }))
            }
            aria-label="Filter by event type"
          >
            <option value="">All events</option>
            {LOGIN_HISTORY_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="app-sort-field">
          <span className="sr-only">From date</span>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, from: event.target.value }))
            }
            aria-label="From date"
            className="w-auto"
          />
        </label>
        <label className="app-sort-field">
          <span className="sr-only">To date</span>
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            aria-label="To date"
            className="w-auto"
          />
        </label>
        {active ? (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw aria-hidden="true" />
            Reset filters
          </Button>
        ) : null}
      </div>

      {error ? (
        <InlineError
          title="Login history unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load(0, false)}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading login history" variant="table" />
      ) : events && events.length > 0 ? (
        <>
          <Table aria-busy={loadingMore || undefined}>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>IP address</TableHead>
                <TableHead>Device</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events?.map((event, index) => {
                const outcome = EVENT_OUTCOME[event.type] ?? "info"
                const detail = eventDetail(event)
                return (
                  <TableRow key={`${event.timestamp}-${event.type}-${index}`}>
                    <TableCell>
                      <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{EVENT_LABELS[event.type] ?? event.type}</span>
                      {detail ? (
                        <span className="text-muted-foreground block text-xs">{detail}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={OUTCOME_BADGE_VARIANT[outcome]}>
                        {OUTCOME_LABEL[outcome]}
                      </Badge>
                    </TableCell>
                    <TableCell>{event.ip ?? "—"}</TableCell>
                    <TableCell className="max-w-48 truncate" title={event.userAgent ?? undefined}>
                      {event.userAgent ?? "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <div className="app-panel-head-actions">
            {hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Loading…" : `Load more (${total - (events?.length ?? 0)} left)`}
              </Button>
            ) : null}
          </div>
        </>
      ) : error ? null : (
        <EmptyState
          icon={<History aria-hidden="true" />}
          title={active ? "No events match these filters" : "No login history yet"}
          body={
            active
              ? "Try a different event type or widen the date range."
              : "Sign-ins, failed attempts, and account security changes will appear here."
          }
          secondaryAction={
            active
              ? { label: "Clear filters", onClick: resetFilters, variant: "outline" }
              : undefined
          }
        />
      )}
    </section>
  )
}
