"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, MailSearch } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
 * Admin "Email delivery" screen for `/app/admin/email-delivery`: stats cards
 * (status counts + event-based rate approximations) and a filterable,
 * paginated delivery table backed by `GET /api/admin/email-delivery`, with a
 * per-row expandable event timeline loaded lazily from
 * `GET /api/admin/email-delivery/[emailId]`.
 *
 * Backed by the in-memory dev-seam store in `src/lib/email-delivery.ts` —
 * records only appear once send paths are wired to `trackEmailSend`/
 * `recordEvent` (see that module's docstring). Rates shown here are
 * event-based approximations, not unique-open metrics. The table does not
 * auto-refresh.
 */

const DELIVERY_API = "/api/admin/email-delivery"
const PAGE_SIZE = 50

export type EmailDeliveryStatus =
  "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained"

export interface EmailDeliveryEventRow {
  type: EmailDeliveryStatus
  at: string
  meta?: Record<string, unknown>
}

export interface EmailDeliveryRow {
  emailId: string
  to: string
  templateKey?: string
  events: EmailDeliveryEventRow[]
  status: EmailDeliveryStatus
  createdAt: string
}

export interface EmailDeliveryStatsPayload {
  total: number
  byStatus: Record<EmailDeliveryStatus, number>
  rates: {
    deliveryRate: number | null
    bounceRate: number | null
    openRate: number | null
    complaintRate: number | null
  }
}

interface ListResponse {
  ok: boolean
  deliveries?: EmailDeliveryRow[]
  total?: number
  stats?: EmailDeliveryStatsPayload
  message?: string
}

interface DetailResponse {
  ok: boolean
  delivery?: EmailDeliveryRow
  message?: string
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "bounced", label: "Bounced" },
  { value: "complained", label: "Complained" },
]

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

/** Ratio 0..1 → "66.7%", or "—" when the denominator was empty. */
function formatRate(rate: number | null): string {
  if (rate === null) return "—"
  return `${Math.round(rate * 1000) / 10}%`
}

function statusBadgeVariant(status: EmailDeliveryStatus) {
  if (status === "delivered" || status === "opened" || status === "clicked") {
    return "secondary" as const
  }
  if (status === "bounced" || status === "complained") return "destructive" as const
  if (status === "queued") return "outline" as const
  return "default" as const
}

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; delivery: EmailDeliveryRow }

export function EmailDeliveryScreen() {
  const [statusFilter, setStatusFilter] = useState("")
  const [page, setPage] = useState({ key: "", offset: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  const [deliveries, setDeliveries] = useState<EmailDeliveryRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<EmailDeliveryStatsPayload | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const listSeq = useRef(0)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, DetailState>>({})

  const filtersKey = statusFilter
  const offset = page.key === filtersKey ? page.offset : 0

  const listQuery = useCallback(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (statusFilter) params.set("status", statusFilter)
    return params.toString()
  }, [statusFilter, offset])

  useEffect(() => {
    const seq = ++listSeq.current
    setDeliveries(null)
    setListError(null)
    void (async () => {
      try {
        const response = await fetch(`${DELIVERY_API}?${listQuery()}`, { cache: "no-store" })
        const data = (await response.json()) as ListResponse
        if (seq !== listSeq.current) return
        if (!response.ok || !data.ok) {
          setListError(data.message ?? "Could not load email deliveries.")
          setDeliveries([])
          return
        }
        setDeliveries(data.deliveries ?? [])
        setTotal(data.total ?? 0)
        setStats(data.stats ?? null)
      } catch {
        if (seq !== listSeq.current) return
        setListError("Could not load email deliveries. Check your connection and try again.")
        setDeliveries([])
      }
    })()
  }, [listQuery, reloadKey])

  const fetchDetail = useCallback(async (emailId: string) => {
    setDetails((current) => ({ ...current, [emailId]: { kind: "loading" } }))
    try {
      const response = await fetch(`${DELIVERY_API}/${emailId}`, { cache: "no-store" })
      const data = (await response.json()) as DetailResponse
      setDetails((latest) => ({
        ...latest,
        [emailId]:
          response.ok && data.ok && data.delivery
            ? { kind: "ready", delivery: data.delivery }
            : {
                kind: "error",
                message: data.message ?? "Could not load the delivery timeline.",
              },
      }))
    } catch {
      setDetails((latest) => ({
        ...latest,
        [emailId]: {
          kind: "error",
          message: "Could not load the delivery timeline. Check your connection and try again.",
        },
      }))
    }
  }, [])

  const toggleExpand = useCallback(
    (emailId: string) => {
      if (expandedId === emailId) {
        setExpandedId(null)
        return
      }
      setExpandedId(emailId)
      // Fetch lazily; `ready` results are cached, `error`/`loading` retry.
      const existing = details[emailId]
      if (existing?.kind === "ready") return
      void fetchDetail(emailId)
    },
    [expandedId, details, fetchDetail],
  )

  const loading = deliveries === null && listError === null
  const empty = deliveries !== null && deliveries.length === 0
  const hasFilters = Boolean(statusFilter)
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + (deliveries?.length ?? 0), total)

  const lastEvent = (row: EmailDeliveryRow) => row.events[row.events.length - 1]

  return (
    <div className="flex flex-col gap-6">
      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Tracked emails</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Delivery rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{formatRate(stats.rates.deliveryRate)}</p>
              <p className="text-muted-foreground text-xs">event-based estimate</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Bounce rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{formatRate(stats.rates.bounceRate)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm">Open rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{formatRate(stats.rates.openRate)}</p>
              <p className="text-muted-foreground text-xs">not unique opens</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <section className="app-panel" aria-labelledby="email-delivery-table-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="email-delivery-table-heading">Deliveries</h2>
            <p>
              Lifecycle events per outbound email, most recently active first. Rates are event-based
              approximations from the in-memory dev store — send paths are not wired to tracking
              yet, so this may be empty.
            </p>
          </div>
          <div className="app-panel-head-actions">
            <div className="flex flex-col gap-1">
              <label htmlFor="delivery-filter-status" className="text-muted-foreground text-xs">
                Status
              </label>
              <Select
                id="delivery-filter-status"
                aria-label="Delivery status"
                options={STATUS_OPTIONS}
                value={statusFilter || null}
                onChange={(value) => setStatusFilter(typeof value === "string" ? value : "")}
              />
            </div>
            {hasFilters ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setStatusFilter("")}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>

        {listError ? (
          <InlineError
            title="Deliveries unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{listError}</span>
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
          <LoadingPanel label="Loading deliveries" variant="table" />
        ) : empty ? (
          <EmptyState
            icon={<MailSearch aria-hidden="true" />}
            title={hasFilters ? "No matching deliveries" : "No tracked deliveries"}
            body={
              hasFilters
                ? "Nothing matches the current status filter."
                : "No email delivery events recorded yet. Tracking is wired into send paths via trackEmailSend/recordEvent — see src/lib/email-delivery.ts."
            }
          />
        ) : listError ? null : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>To</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(deliveries ?? []).map((row) => {
                  const expanded = expandedId === row.emailId
                  const last = lastEvent(row)
                  return [
                    <TableRow key={row.emailId}>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={expanded ? "Hide event timeline" : "Show event timeline"}
                          aria-expanded={expanded}
                          onClick={() => toggleExpand(row.emailId)}
                        >
                          {expanded ? (
                            <ChevronDown aria-hidden="true" className="size-4" />
                          ) : (
                            <ChevronRight aria-hidden="true" className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{row.to}</TableCell>
                      <TableCell>{row.templateKey ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {last ? (
                          <span className="flex flex-col">
                            <span>{last.type}</span>
                            <span className="text-muted-foreground text-xs">
                              {formatDateTime(last.at)}
                            </span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>,
                    expanded ? (
                      <TableRow key={`${row.emailId}-timeline`}>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <DeliveryTimeline emailId={row.emailId} state={details[row.emailId]} />
                        </TableCell>
                      </TableRow>
                    ) : null,
                  ]
                })}
              </TableBody>
            </Table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">
                Showing {rangeStart}–{rangeEnd} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() =>
                    setPage({ key: filtersKey, offset: Math.max(0, offset - PAGE_SIZE) })
                  }
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setPage({ key: filtersKey, offset: offset + PAGE_SIZE })}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function DeliveryTimeline({ emailId, state }: { emailId: string; state?: DetailState }) {
  if (!state || state.kind === "loading") {
    return <p className="text-muted-foreground py-2 text-sm">Loading event timeline…</p>
  }
  if (state.kind === "error") {
    return <p className="text-destructive py-2 text-sm">{state.message}</p>
  }
  const events = state.delivery.events
  return (
    <div className="flex flex-col gap-1 py-2" data-testid={`timeline-${emailId}`}>
      <p className="text-muted-foreground text-xs font-medium">
        {events.length} event{events.length === 1 ? "" : "s"} · id {emailId}
      </p>
      <ol className="flex flex-col gap-1">
        {events.map((event, index) => (
          <li key={`${event.type}-${index}`} className="flex items-baseline gap-2 text-sm">
            <Badge variant={statusBadgeVariant(event.type)}>{event.type}</Badge>
            <span className="text-muted-foreground whitespace-nowrap">
              {formatDateTime(event.at)}
            </span>
            {event.meta ? (
              <code className="text-muted-foreground truncate text-xs">
                {JSON.stringify(event.meta)}
              </code>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
