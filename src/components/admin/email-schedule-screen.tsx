"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarClock, Send, X } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Email schedule" screen for `/app/admin/email-schedule`: a form that
 * enqueues outbound emails via `POST /api/admin/email-schedule`, a
 * filterable/paginated queue table backed by `GET` on the same endpoint, and
 * per-row cancel via `DELETE /api/admin/email-schedule/[id]`.
 *
 * Delivery: nothing sends automatically — there is no cron/worker. The "Run
 * due now" button calls `POST /api/admin/email-schedule/tick`, which runs
 * `processDue()` once (the documented scheduler seam; a real scheduler is a
 * follow-up). The queue does not auto-refresh; reload after scheduling,
 * canceling, or ticking.
 *
 * Backed by the in-memory dev-seam store in `src/lib/email-scheduler.ts`.
 */

const SCHEDULE_API = "/api/admin/email-schedule"
const PAGE_SIZE = 50
const SUBJECT_MAX = 200
const BODY_MAX = 50_000
const TEMPLATE_KEY_MAX = 120

export type ScheduledEmailStatus = "scheduled" | "sent" | "failed" | "canceled"

export interface ScheduledEmailRow {
  id: string
  to: string
  subject: string
  textBody?: string
  htmlBody?: string
  templateKey?: string
  sendAt: string
  status: ScheduledEmailStatus
  lastError?: string
  createdAt: string
  sentAt?: string
}

interface ScheduleListResponse {
  ok: boolean
  emails?: ScheduledEmailRow[]
  total?: number
  message?: string
}

interface TickResponse {
  ok: boolean
  processed?: number
  sent?: number
  failed?: number
  message?: string
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
]

/** `datetime-local` value → ISO string, or null when empty/unparseable. */
function toIso(local: string): string | null {
  if (!local) return null
  const date = new Date(local)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function statusBadgeVariant(status: ScheduledEmailStatus) {
  if (status === "sent") return "secondary" as const
  if (status === "failed") return "destructive" as const
  if (status === "canceled") return "outline" as const
  return "default" as const
}

export function EmailScheduleScreen() {
  const [statusFilter, setStatusFilter] = useState("")
  const [page, setPage] = useState({ key: "", offset: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  const [emails, setEmails] = useState<ScheduledEmailRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const listSeq = useRef(0)

  const [to, setTo] = useState("")
  const [subject, setSubject] = useState("")
  const [sendAtLocal, setSendAtLocal] = useState("")
  const [textBody, setTextBody] = useState("")
  const [htmlBody, setHtmlBody] = useState("")
  const [templateKey, setTemplateKey] = useState("")
  const [scheduling, setScheduling] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)

  const [ticking, setTicking] = useState(false)
  const [tickResult, setTickResult] = useState<string | null>(null)
  const [tickError, setTickError] = useState<string | null>(null)

  const filtersKey = statusFilter
  const offset = page.key === filtersKey ? page.offset : 0

  const listQuery = useCallback(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (statusFilter) params.set("status", statusFilter)
    return params.toString()
  }, [statusFilter, offset])

  useEffect(() => {
    const seq = ++listSeq.current
    setEmails(null)
    setListError(null)
    void (async () => {
      try {
        const response = await fetch(`${SCHEDULE_API}?${listQuery()}`, { cache: "no-store" })
        const data = (await response.json()) as ScheduleListResponse
        if (seq !== listSeq.current) return
        if (!response.ok || !data.ok) {
          setListError(data.message ?? "Could not load the schedule.")
          setEmails([])
          return
        }
        setEmails(data.emails ?? [])
        setTotal(data.total ?? 0)
      } catch {
        if (seq !== listSeq.current) return
        setListError("Could not load the schedule. Check your connection and try again.")
        setEmails([])
      }
    })()
  }, [listQuery, reloadKey])

  const schedule = useCallback(async () => {
    const sendAt = toIso(sendAtLocal)
    if (!sendAt) {
      setFormError("Pick a valid send date and time.")
      return
    }
    setScheduling(true)
    setFormError(null)
    setFormNotice(null)
    try {
      const response = await fetch(SCHEDULE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          sendAt,
          ...(textBody.trim() ? { textBody } : {}),
          ...(htmlBody.trim() ? { htmlBody } : {}),
          ...(templateKey.trim() ? { templateKey: templateKey.trim() } : {}),
        }),
      })
      const data = (await response.json()) as { ok: boolean; message?: string }
      if (!response.ok || !data.ok) {
        setFormError(data.message ?? "Could not schedule the email.")
        return
      }
      setTo("")
      setSubject("")
      setSendAtLocal("")
      setTextBody("")
      setHtmlBody("")
      setTemplateKey("")
      setFormNotice("Email scheduled. It will send on the next scheduler tick after the send time.")
      setReloadKey((key) => key + 1)
    } catch {
      setFormError("Could not schedule the email. Check your connection and try again.")
    } finally {
      setScheduling(false)
    }
  }, [to, subject, sendAtLocal, textBody, htmlBody, templateKey])

  const cancel = useCallback(async (id: string) => {
    setCancelingId(id)
    setListError(null)
    try {
      const response = await fetch(`${SCHEDULE_API}/${id}`, { method: "DELETE" })
      const data = (await response.json()) as { ok: boolean; message?: string }
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not cancel the scheduled email.")
        return
      }
      setReloadKey((key) => key + 1)
    } catch {
      setListError("Could not cancel the scheduled email. Check your connection and try again.")
    } finally {
      setCancelingId(null)
    }
  }, [])

  const runDueNow = useCallback(async () => {
    setTicking(true)
    setTickError(null)
    setTickResult(null)
    try {
      const response = await fetch(`${SCHEDULE_API}/tick`, { method: "POST" })
      const data = (await response.json()) as TickResponse
      if (!response.ok || !data.ok) {
        setTickError(data.message ?? "Could not run the scheduler.")
        return
      }
      setTickResult(
        `Scheduler tick complete: ${data.processed ?? 0} due, ${data.sent ?? 0} sent, ${data.failed ?? 0} failed.`,
      )
      setReloadKey((key) => key + 1)
    } catch {
      setTickError("Could not run the scheduler. Check your connection and try again.")
    } finally {
      setTicking(false)
    }
  }, [])

  const loading = emails === null && listError === null
  const empty = emails !== null && emails.length === 0
  const hasFilters = Boolean(statusFilter)
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + (emails?.length ?? 0), total)
  const hasBody = Boolean(textBody.trim() || htmlBody.trim() || templateKey.trim())

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="email-schedule-form-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="email-schedule-form-heading">Schedule an email</h2>
            <p>
              Queue a one-off outbound email. Nothing sends automatically — use “Run due now” below
              or wait for the scheduler (a cron/worker is a follow-up).
            </p>
          </div>
          <div className="app-panel-head-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ticking}
              onClick={() => void runDueNow()}
            >
              <Send aria-hidden="true" className="size-4" />
              {ticking ? "Running…" : "Run due now"}
            </Button>
          </div>
        </div>

        {tickResult ? <p className="text-muted-foreground mb-3 text-sm">{tickResult}</p> : null}
        {tickError ? <p className="text-destructive mb-3 text-sm">{tickError}</p> : null}

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!to.trim() || !subject.trim() || !sendAtLocal || !hasBody || scheduling) return
            void schedule()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="schedule-to" className="text-muted-foreground text-xs">
                To
              </label>
              <Input
                id="schedule-to"
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="recipient@example.com"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="schedule-send-at" className="text-muted-foreground text-xs">
                Send at
              </label>
              <Input
                id="schedule-send-at"
                type="datetime-local"
                value={sendAtLocal}
                onChange={(event) => setSendAtLocal(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="schedule-subject" className="text-muted-foreground text-xs">
              Subject
            </label>
            <Input
              id="schedule-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Email subject"
              maxLength={SUBJECT_MAX}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="schedule-text-body" className="text-muted-foreground text-xs">
              Text body
            </label>
            <Textarea
              id="schedule-text-body"
              value={textBody}
              onChange={(event) => setTextBody(event.target.value)}
              placeholder="Plain-text body"
              rows={4}
              maxLength={BODY_MAX}
              showCount
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="schedule-html-body" className="text-muted-foreground text-xs">
              HTML body (optional)
            </label>
            <Textarea
              id="schedule-html-body"
              value={htmlBody}
              onChange={(event) => setHtmlBody(event.target.value)}
              placeholder="HTML body sent alongside the text body"
              rows={3}
              maxLength={BODY_MAX}
              showCount
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="schedule-template-key" className="text-muted-foreground text-xs">
              Template key (optional, recorded for future template rendering)
            </label>
            <Input
              id="schedule-template-key"
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value)}
              placeholder="e.g. welcome-followup"
              maxLength={TEMPLATE_KEY_MAX}
            />
          </div>
          {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
          {formNotice ? <p className="text-muted-foreground text-sm">{formNotice}</p> : null}
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={scheduling || !to.trim() || !subject.trim() || !sendAtLocal || !hasBody}
            >
              <CalendarClock aria-hidden="true" className="size-4" />
              {scheduling ? "Scheduling…" : "Schedule email"}
            </Button>
          </div>
        </form>
      </section>

      <section className="app-panel" aria-labelledby="email-schedule-queue-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="email-schedule-queue-heading">Queue</h2>
            <p>
              Scheduled and resolved emails, soonest send first. The queue does not refresh
              automatically — reload after scheduling, canceling, or running a tick.
            </p>
          </div>
          <div className="app-panel-head-actions">
            <div className="flex flex-col gap-1">
              <label htmlFor="schedule-filter-status" className="text-muted-foreground text-xs">
                Status
              </label>
              <Select
                id="schedule-filter-status"
                aria-label="Scheduled email status"
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
            title="Schedule unavailable"
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
          <LoadingPanel label="Loading schedule" variant="table" />
        ) : empty ? (
          <EmptyState
            icon={<CalendarClock aria-hidden="true" />}
            title={hasFilters ? "No matching emails" : "No scheduled emails"}
            body={
              hasFilters
                ? "Nothing matches the current status filter."
                : "Schedule an email above — it will appear here until it is sent or canceled."
            }
          />
        ) : listError ? null : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Send at</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(emails ?? []).map((email) => (
                  <TableRow key={email.id}>
                    <TableCell className="font-medium">{email.to}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{email.subject}</span>
                        {email.lastError ? (
                          <span className="text-destructive text-xs">{email.lastError}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(email.sendAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(email.status)}>{email.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {email.status === "scheduled" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={cancelingId === email.id}
                          onClick={() => void cancel(email.id)}
                        >
                          <X aria-hidden="true" className="size-4" />
                          {cancelingId === email.id ? "Canceling…" : "Cancel"}
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
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
