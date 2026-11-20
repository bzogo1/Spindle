"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { LifeBuoy, Plus, Send } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_LIMITS,
  SUPPORT_TICKET_STATUSES,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from "@/lib/support-tickets"

/**
 * "Support" screen for `/app/support`: user-facing help tickets backed by
 * `/api/support/tickets*` (in-memory dev seam — see `@/lib/support-tickets`).
 *
 * Three panes in one panel: the ticket list (status filter + "New ticket"),
 * a create form, and a detail view with the message thread, reply box, and
 * owner status actions (close/reopen). The API scopes everything to the
 * caller, so this screen can never show another user's tickets.
 */

const TICKETS_API = "/api/support/tickets"

const CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  general: "General",
  billing: "Billing",
  technical: "Technical",
  account: "Account",
}

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
}

const STATUS_BADGE_VARIANT: Record<
  SupportTicketStatus,
  "default" | "secondary" | "outline" | "ghost"
> = {
  open: "secondary",
  pending: "outline",
  resolved: "default",
  closed: "ghost",
}

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  ...SUPPORT_TICKET_STATUSES.map((status) => ({
    value: status,
    label: STATUS_LABELS[status],
  })),
]

interface TicketListResponse {
  ok: boolean
  tickets?: SupportTicket[]
  total?: number
  hasMore?: boolean
  message?: string
}

interface TicketResponse {
  ok: boolean
  ticket?: SupportTicket
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

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string }
    return data.message ?? fallback
  } catch {
    return fallback
  }
}

type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: string }

export function SupportTicketsScreen() {
  const [view, setView] = useState<View>({ kind: "list" })
  const [statusFilter, setStatusFilter] = useState("all")
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), [])

  return (
    <section className="app-panel" aria-labelledby="support-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="support-heading">Support tickets</h2>
          <p>
            Get help from the team. Track replies and status here — tickets are private to your
            account.
          </p>
        </div>
        <div className="app-panel-head-actions">
          {view.kind !== "new" ? (
            <Button type="button" size="sm" onClick={() => setView({ kind: "new" })}>
              <Plus aria-hidden="true" /> New ticket
            </Button>
          ) : null}
        </div>
      </div>

      {view.kind === "new" ? (
        <NewTicketForm
          onCancel={() => setView({ kind: "list" })}
          onCreated={(ticket) => {
            refresh()
            setView({ kind: "detail", id: ticket.id })
          }}
        />
      ) : view.kind === "detail" ? (
        <TicketDetail
          ticketId={view.id}
          onBack={() => {
            refresh()
            setView({ kind: "list" })
          }}
        />
      ) : (
        <TicketList
          key={`${statusFilter}-${refreshKey}`}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onOpen={(id) => setView({ kind: "detail", id })}
        />
      )}
    </section>
  )
}

function TicketList({
  statusFilter,
  onStatusFilter,
  onOpen,
}: {
  statusFilter: string
  onStatusFilter: (value: string) => void
  onOpen: (id: string) => void
}) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(SUPPORT_TICKET_LIMITS.maxPageSize) })
      if (statusFilter !== "all") params.set("status", statusFilter)
      const response = await fetch(`${TICKETS_API}?${params.toString()}`, { cache: "no-store" })
      if (!response.ok) {
        setError(await readError(response, "Could not load your tickets."))
        setTickets([])
        return
      }
      const data = (await response.json()) as TicketListResponse
      if (!data.ok) {
        setError(data.message ?? "Could not load your tickets.")
        setTickets([])
        return
      }
      setTickets(data.tickets ?? [])
    } catch {
      setError("Could not load your tickets. Check your connection and try again.")
      setTickets([])
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const loading = tickets === null && error === null
  const empty = tickets !== null && tickets.length === 0

  return (
    <>
      <div className="app-panel-head-actions">
        <Select
          id="support-status-filter"
          aria-label="Filter tickets by status"
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={(next) => onStatusFilter(typeof next === "string" ? next : "all")}
        />
      </div>

      {error ? (
        <InlineError
          title="Tickets unavailable"
          message={error}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading tickets" variant="table" />
      ) : empty ? (
        <EmptyState
          icon={<LifeBuoy aria-hidden="true" />}
          title={statusFilter === "all" ? "No support tickets yet" : "No tickets with this status"}
          body={
            statusFilter === "all"
              ? "Create a ticket and our team will get back to you here."
              : "Try a different status filter, or create a new ticket."
          }
          primaryAction={
            statusFilter === "all"
              ? undefined
              : { label: "Show all tickets", onClick: () => onStatusFilter("all") }
          }
        />
      ) : (
        <ul className="grid gap-2">
          {(tickets ?? []).map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => onOpen(ticket.id)}
                className="hover:bg-accent/50 flex w-full flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{ticket.subject}</span>
                  <Badge variant="outline" size="sm">
                    {CATEGORY_LABELS[ticket.category]}
                  </Badge>
                  <Badge variant={STATUS_BADGE_VARIANT[ticket.status]} size="sm">
                    {STATUS_LABELS[ticket.status]}
                  </Badge>
                </span>
                <span className="text-muted-foreground text-xs">
                  Updated {formatTimestamp(ticket.updatedAt)} · {ticket.messages.length}{" "}
                  {ticket.messages.length === 1 ? "message" : "messages"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function NewTicketForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (ticket: SupportTicket) => void
}) {
  const [subject, setSubject] = useState("")
  const [category, setCategory] = useState<SupportTicketCategory>("general")
  const [message, setMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(TICKETS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, category, message }),
      })
      if (!response.ok) {
        setError(await readError(response, "Could not create the ticket. Try again."))
        return
      }
      const data = (await response.json()) as TicketResponse
      if (!data.ok || !data.ticket) {
        setError(data.message ?? "Could not create the ticket. Try again.")
        return
      }
      onCreated(data.ticket)
    } catch {
      setError("Could not create the ticket. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid max-w-xl gap-4">
      <div className="grid gap-2">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Short summary of the issue"
          minLength={SUPPORT_TICKET_LIMITS.subjectMin}
          maxLength={SUPPORT_TICKET_LIMITS.subjectMax}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="support-category">Category</Label>
        <Select
          id="support-category"
          options={SUPPORT_TICKET_CATEGORIES.map((value) => ({
            value,
            label: CATEGORY_LABELS[value],
          }))}
          value={category}
          onChange={(next) => {
            if (typeof next === "string") setCategory(next as SupportTicketCategory)
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="support-message">Message</Label>
        <Textarea
          id="support-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Describe the problem and what you expected to happen."
          rows={6}
          maxLength={SUPPORT_TICKET_LIMITS.messageMax}
          required
        />
      </div>

      {error ? <InlineError title="Ticket not created" message={error} /> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create ticket"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function TicketDetail({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const [ticket, setTicket] = useState<SupportTicket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState("")
  const [busy, setBusy] = useState<"reply" | "status" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`${TICKETS_API}/${ticketId}`, { cache: "no-store" })
      if (!response.ok) {
        setError(await readError(response, "Could not load the ticket."))
        setTicket(null)
        return
      }
      const data = (await response.json()) as TicketResponse
      if (!data.ok || !data.ticket) {
        setError(data.message ?? "Could not load the ticket.")
        setTicket(null)
        return
      }
      setTicket(data.ticket)
    } catch {
      setError("Could not load the ticket. Check your connection and try again.")
      setTicket(null)
    }
  }, [ticketId])

  useEffect(() => {
    void load()
  }, [load])

  async function sendReply() {
    if (busy || !reply.trim()) return
    setBusy("reply")
    setActionError(null)
    try {
      const response = await fetch(`${TICKETS_API}/${ticketId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: reply }),
      })
      if (!response.ok) {
        setActionError(await readError(response, "Could not send your reply."))
        return
      }
      const data = (await response.json()) as TicketResponse
      if (data.ticket) setTicket(data.ticket)
      setReply("")
    } catch {
      setActionError("Could not send your reply. Check your connection and try again.")
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(status: "open" | "closed") {
    if (busy) return
    setBusy("status")
    setActionError(null)
    try {
      const response = await fetch(`${TICKETS_API}/${ticketId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) {
        setActionError(await readError(response, "Could not update the ticket."))
        return
      }
      const data = (await response.json()) as TicketResponse
      if (data.ticket) setTicket(data.ticket)
    } catch {
      setActionError("Could not update the ticket. Check your connection and try again.")
    } finally {
      setBusy(null)
    }
  }

  const loading = ticket === null && error === null

  return (
    <div className="grid gap-4">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          ← Back to tickets
        </Button>
      </div>

      {error ? (
        <InlineError
          title="Ticket unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading ticket" variant="table" /> : null}

      {ticket ? (
        <>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">{ticket.subject}</h3>
              <Badge variant="outline" size="sm">
                {CATEGORY_LABELS[ticket.category]}
              </Badge>
              <Badge variant={STATUS_BADGE_VARIANT[ticket.status]} size="sm">
                {STATUS_LABELS[ticket.status]}
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              Opened {formatTimestamp(ticket.createdAt)} · updated{" "}
              {formatTimestamp(ticket.updatedAt)}
            </p>
            <div className="flex gap-2">
              {ticket.status !== "closed" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void changeStatus("closed")}
                >
                  Close ticket
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void changeStatus("open")}
                >
                  Reopen ticket
                </Button>
              )}
            </div>
          </div>

          <ol className="grid gap-3">
            {ticket.messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.author === "agent"
                    ? "bg-primary/5 rounded-lg border px-4 py-3"
                    : "bg-muted/40 rounded-lg border px-4 py-3"
                }
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {message.author === "agent" ? "Support" : "You"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatTimestamp(message.createdAt)}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{message.body}</p>
              </li>
            ))}
          </ol>

          {actionError ? <InlineError title="Action failed" message={actionError} /> : null}

          {ticket.status === "closed" ? (
            <p className="text-muted-foreground text-sm">
              This ticket is closed. Reopen it to add another reply.
            </p>
          ) : (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void sendReply()
              }}
            >
              <Label htmlFor="support-reply">Reply</Label>
              <Textarea
                id="support-reply"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Write a reply to support…"
                rows={4}
                maxLength={SUPPORT_TICKET_LIMITS.messageMax}
              />
              <div>
                <Button type="submit" size="sm" disabled={busy !== null || !reply.trim()}>
                  <Send aria-hidden="true" /> {busy === "reply" ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </div>
  )
}
