"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mail, Search } from "lucide-react"

import { CONTACT_TOPIC_LABELS } from "@/lib/site-form-constants"
import type { ContactTopic } from "@/lib/site-form-constants"
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

/**
 * Admin "Contact inbox" screen for `/app/admin/contact`: a filterable,
 * offset-paginated triage list of public contact-form submissions backed by
 * `GET/PATCH /api/admin/contact`.
 *
 * Queue/status vocabularies mirror `src/lib/contact-routing.ts`, which is
 * server-only (it pulls in zod via `site-forms`), so the option lists are
 * duplicated here — keep them in sync when queues change.
 */

const CONTACT_API = "/api/admin/contact"
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

/** Mirrors CONTACT_QUEUES / CONTACT_QUEUE_LABELS in lib/contact-routing. */
const QUEUE_OPTIONS = [
  { value: "", label: "All queues" },
  { value: "support", label: "Support" },
  { value: "sales", label: "Sales" },
  { value: "billing", label: "Billing" },
  { value: "security", label: "Security" },
  { value: "press", label: "Press" },
  { value: "general", label: "General" },
]

/** Mirrors CONTACT_SUBMISSION_STATUSES in lib/contact-routing. */
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "spam", label: "Spam" },
]

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_progress: "In progress",
  resolved: "Resolved",
  spam: "Spam",
}

/** Serialized `ContactSubmission` from lib/contact-routing (ISO dates). */
export interface ContactSubmissionRow {
  id: string
  name: string
  email: string
  topic: ContactTopic
  subject: string
  message: string
  messagePreview: string
  reference?: string
  routedTo: string
  status: string
  assignee?: string
  spamSignals?: string[]
  createdAt: string
  updatedAt: string
}

interface InboxResponse {
  ok: boolean
  submissions?: ContactSubmissionRow[]
  submission?: ContactSubmissionRow
  total?: number
  message?: string
}

interface InboxFilters {
  status: string
  queue: string
  q: string
}

const EMPTY_FILTERS: InboxFilters = { status: "", queue: "", q: "" }

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function statusBadgeVariant(status: string) {
  if (status === "spam") return "destructive" as const
  if (status === "resolved") return "secondary" as const
  if (status === "in_progress") return "outline" as const
  return "default" as const
}

function queueBadgeVariant(queue: string) {
  if (queue === "billing" || queue === "security") return "destructive" as const
  if (queue === "press" || queue === "sales") return "secondary" as const
  return "outline" as const
}

function topicLabel(topic: string): string {
  return CONTACT_TOPIC_LABELS[topic as ContactTopic] ?? topic
}

function queueLabel(queue: string): string {
  return QUEUE_OPTIONS.find((option) => option.value === queue)?.label ?? queue
}

export function ContactInbox() {
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  // Pagination is keyed to the filter signature: when filters change the key
  // no longer matches and the effective offset falls back to 0 — no reset
  // effect or extra fetch required.
  const [page, setPage] = useState({ key: "", offset: 0 })
  const [reloadKey, setReloadKey] = useState(0)

  const [submissions, setSubmissions] = useState<ContactSubmissionRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const requestSeq = useRef(0)

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const effectiveFilters: InboxFilters = { ...filters, q: debouncedSearch }
  const filtersKey = JSON.stringify(effectiveFilters)
  const offset = page.key === filtersKey ? page.offset : 0

  const patchFilters = useCallback((patch: Partial<InboxFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }, [])

  const goToOffset = useCallback(
    (next: number) => setPage({ key: filtersKey, offset: next }),
    [filtersKey],
  )

  const queryString = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams()
      if (effectiveFilters.status) params.set("status", effectiveFilters.status)
      if (effectiveFilters.queue) params.set("queue", effectiveFilters.queue)
      if (effectiveFilters.q) params.set("q", effectiveFilters.q)
      for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
      const qs = params.toString()
      return qs ? `?${qs}` : ""
    },
    // filtersKey is a stable serialization of every effectiveFilters field.
    [filtersKey],
  )

  // Refetches when filters, offset, or a manual retry/status update changes.
  useEffect(() => {
    const seq = ++requestSeq.current
    setSubmissions(null)
    setError(null)
    void (async () => {
      try {
        const response = await fetch(
          `${CONTACT_API}${queryString({ limit: String(PAGE_SIZE), offset: String(offset) })}`,
          { cache: "no-store" },
        )
        const data = (await response.json()) as InboxResponse
        if (seq !== requestSeq.current) return
        if (!response.ok || !data.ok) {
          setError(data.message ?? "Could not load the contact inbox.")
          setSubmissions([])
          return
        }
        setSubmissions(data.submissions ?? [])
        setTotal(data.total ?? 0)
      } catch {
        if (seq !== requestSeq.current) return
        setError("Could not load the contact inbox. Check your connection and try again.")
        setSubmissions([])
      }
    })()
  }, [queryString, offset, reloadKey])

  const updateStatus = useCallback(async (submission: ContactSubmissionRow, status: string) => {
    setPendingId(submission.id)
    setActionError(null)
    try {
      const response = await fetch(CONTACT_API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: submission.id, status }),
      })
      const data = (await response.json()) as InboxResponse
      if (!response.ok || !data.ok || !data.submission) {
        setActionError(data.message ?? "Could not update the submission.")
        return
      }
      const updated = data.submission as ContactSubmissionRow
      setSubmissions((prev) =>
        prev ? prev.map((row) => (row.id === updated.id ? updated : row)) : prev,
      )
    } catch {
      setActionError("Could not update the submission. Check your connection and try again.")
    } finally {
      setPendingId(null)
    }
  }, [])

  const loading = submissions === null && error === null
  const empty = submissions !== null && submissions.length === 0
  const hasActiveFilters = Object.values(effectiveFilters).some(Boolean)
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + (submissions?.length ?? 0), total)

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setSearchInput("")
    setDebouncedSearch("")
  }

  return (
    <section className="app-panel" aria-labelledby="admin-contact-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="admin-contact-heading">Submissions</h2>
          <p>
            Contact-form messages routed to queues, newest first. Expand a row to read the full
            message and update its status.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedSearch(searchInput.trim())
            }}
          >
            <div className="relative">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search name, email, subject"
                aria-label="Search submissions"
                className="w-64 pl-8"
              />
            </div>
          </form>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="contact-filter-status" className="text-muted-foreground text-xs">
            Status
          </label>
          <Select
            id="contact-filter-status"
            aria-label="Status"
            options={STATUS_OPTIONS}
            value={filters.status || null}
            onChange={(value) => patchFilters({ status: typeof value === "string" ? value : "" })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="contact-filter-queue" className="text-muted-foreground text-xs">
            Queue
          </label>
          <Select
            id="contact-filter-queue"
            aria-label="Queue"
            options={QUEUE_OPTIONS}
            value={filters.queue || null}
            onChange={(value) => patchFilters({ queue: typeof value === "string" ? value : "" })}
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
          title="Contact inbox unavailable"
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

      {actionError ? <InlineError title="Update failed" message={actionError} /> : null}

      {loading ? (
        <LoadingPanel label="Loading contact submissions" variant="table" />
      ) : empty ? (
        <EmptyState
          icon={<Mail aria-hidden="true" />}
          title={hasActiveFilters ? "No matching submissions" : "No submissions yet"}
          body={
            hasActiveFilters
              ? "Nothing matches the current filters. Try widening them or clearing filters."
              : "Contact-form messages will appear here once visitors submit the form."
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(submissions ?? []).map((submission) => {
                const expanded = expandedId === submission.id
                return (
                  <SubmissionRows
                    key={submission.id}
                    submission={submission}
                    expanded={expanded}
                    pending={pendingId === submission.id}
                    onToggle={() =>
                      setExpandedId((current) => (current === submission.id ? null : submission.id))
                    }
                    onStatus={(status) => void updateStatus(submission, status)}
                  />
                )
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
                onClick={() => goToOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
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

function SubmissionRows({
  submission,
  expanded,
  pending,
  onToggle,
  onStatus,
}: {
  submission: ContactSubmissionRow
  expanded: boolean
  pending: boolean
  onToggle: () => void
  onStatus: (status: string) => void
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle} aria-expanded={expanded}>
        <TableCell>
          <div className="font-medium">{submission.name}</div>
          <div className="text-muted-foreground text-xs">{submission.email}</div>
          <div className="text-muted-foreground text-xs">{submission.subject}</div>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{topicLabel(submission.topic)}</Badge>
        </TableCell>
        <TableCell>
          <Badge variant={queueBadgeVariant(submission.routedTo)}>
            {queueLabel(submission.routedTo)}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant={statusBadgeVariant(submission.status)}>
            {STATUS_LABELS[submission.status] ?? submission.status}
          </Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap">{formatDateTime(submission.createdAt)}</TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/40">
            <div className="flex flex-col gap-3 py-2">
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Ticket</dt>
                  <dd className="font-mono text-xs">{submission.id}</dd>
                </div>
                {submission.reference ? (
                  <div>
                    <dt className="text-muted-foreground text-xs">Reference</dt>
                    <dd>{submission.reference}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-muted-foreground text-xs">Assignee</dt>
                  <dd>{submission.assignee ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Updated</dt>
                  <dd>{formatDateTime(submission.updatedAt)}</dd>
                </div>
              </dl>
              {submission.spamSignals && submission.spamSignals.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Spam signals: {submission.spamSignals.join(", ")}
                </p>
              ) : null}
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium">Message</p>
                <p className="text-sm whitespace-pre-wrap">{submission.message}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {submission.status !== "in_progress" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation()
                      onStatus("in_progress")
                    }}
                  >
                    Mark in progress
                  </Button>
                ) : null}
                {submission.status !== "resolved" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation()
                      onStatus("resolved")
                    }}
                  >
                    Mark resolved
                  </Button>
                ) : null}
                {submission.status !== "new" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation()
                      onStatus("new")
                    }}
                  >
                    Reopen
                  </Button>
                ) : null}
                {pending ? <span className="text-muted-foreground text-xs">Updating…</span> : null}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
