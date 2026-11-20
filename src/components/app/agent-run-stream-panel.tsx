"use client"

/**
 * Live agent run log panel.
 *
 * Renders the normalized `AgentStreamEntry[]` produced by
 * `useAgentRunStream` with:
 * - append-only, memoized rows (one state update per network event),
 * - auto-scroll that pauses when the user scrolls up, with a "Jump to latest"
 *   button,
 * - a live text/level/source filter that highlights matches,
 * - a cancel button hitting the run-cancel endpoint,
 * - inline approval cards for `approval_required` entries.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ShieldAlert } from "lucide-react"

import {
  filterAgentStreamEntries,
  highlightRanges,
  streamSources,
  type AgentStreamEntry,
  type AgentStreamKind,
  type AgentStreamLevel,
} from "@/lib/agent-log-stream"
import { clientEnv } from "@/lib/env"
import {
  humanizeStreamError,
  useAgentRunStream,
  type AgentStreamStatus,
} from "@/lib/use-agent-run-stream"

import { formatDateTime } from "./format"

const LEVELS: { value: AgentStreamLevel | "all"; label: string }[] = [
  { value: "all", label: "All levels" },
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
]

const KINDS: { value: AgentStreamKind | "all"; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "log", label: "Log" },
  { value: "status", label: "Status" },
  { value: "approval_required", label: "Approvals" },
  { value: "error", label: "Errors" },
]

function statusLabel(status: AgentStreamStatus) {
  switch (status) {
    case "live":
      return "Live"
    case "connecting":
      return "Connecting…"
    case "reconnecting":
      return "Reconnecting…"
    case "done":
      return "Stream ended"
    case "cancelled":
      return "Cancelled"
    case "unavailable":
      return "Stream unavailable"
    default:
      return "Idle"
  }
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const ranges = useMemo(() => highlightRanges(text, query), [text, query])
  if (ranges.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let cursor = 0
  ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start))
    parts.push(
      <mark key={index} className="app-stream-mark">
        {text.slice(range.start, range.end)}
      </mark>,
    )
    cursor = range.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

const StreamRow = memo(function StreamRow({
  entry,
  query,
}: {
  entry: AgentStreamEntry
  query: string
}) {
  return (
    <div className={`app-stream-row is-${entry.level} is-kind-${entry.kind}`}>
      <time dateTime={entry.timestamp} title={formatDateTime(entry.timestamp)}>
        {formatDateTime(entry.timestamp)}
      </time>
      <span
        className={`app-badge is-${entry.level === "error" ? "failed" : entry.level === "warn" ? "waiting_approval" : "succeeded"}`}
      >
        {entry.level}
      </span>
      <span className="app-stream-source">{entry.source}</span>
      <span className="app-stream-message">
        <HighlightedText text={entry.message} query={query} />
      </span>
    </div>
  )
})

interface ApprovalInfo {
  approvalId: string
  action: string
  summary: string
  status: string
}

function approvalInfo(entry: AgentStreamEntry): ApprovalInfo | null {
  if (entry.kind !== "approval_required" || !entry.data) return null
  const approvalId = entry.data.approvalId ?? entry.data.id
  if (typeof approvalId !== "string") return null
  return {
    approvalId,
    action: typeof entry.data.action === "string" ? entry.data.action : "unknown action",
    summary: typeof entry.data.summary === "string" ? entry.data.summary : entry.message,
    status: typeof entry.data.status === "string" ? entry.data.status : "pending",
  }
}

function StreamApprovalCard({
  info,
  onResolve,
}: {
  info: ApprovalInfo
  onResolve: (decision: "approved" | "rejected") => Promise<boolean>
}) {
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null)
  const [busy, setBusy] = useState(false)
  const resolved =
    pending ?? (info.status === "pending" ? null : (info.status as "approved" | "rejected"))
  const isPending = info.status === "pending" && pending === null

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true)
    const ok = await onResolve(decision)
    setBusy(false)
    if (ok) setPending(decision)
  }

  return (
    <section
      className="app-panel app-approval-card app-stream-approval"
      aria-label="Approval request"
    >
      <div className="app-panel-head">
        <div>
          <h2>
            <ShieldAlert aria-hidden="true" className="app-panel-icon" /> Approval required
          </h2>
          <p>{info.action.replace(/_/g, " ")} · streamed live from the run</p>
        </div>
        <span className={`app-badge is-${resolved ?? "pending"}`}>
          {resolved === "approved"
            ? "approved"
            : resolved === "rejected"
              ? "rejected"
              : "Awaiting decision"}
        </span>
      </div>
      <p className="app-approval-summary">{info.summary}</p>
      {isPending ? (
        <div className="app-approval-actions">
          <button
            type="button"
            className="fm-btn fm-btn--solid"
            disabled={busy}
            onClick={() => void decide("approved")}
          >
            Approve
          </button>
          <button
            type="button"
            className="fm-btn fm-btn--danger"
            disabled={busy}
            onClick={() => void decide("rejected")}
          >
            Reject
          </button>
        </div>
      ) : resolved ? (
        <p className="app-approval-note" role="status">
          Decision recorded as “{resolved}”.
        </p>
      ) : null}
    </section>
  )
}

const NEAR_BOTTOM_PX = 48

export function AgentRunStreamPanel({
  runId,
  enabled = true,
}: {
  runId: string
  /** When false the stream stays idle (e.g. for finished runs). */
  enabled?: boolean
}) {
  // The mock adapter serves fixture data only — there is no `/stream` route
  // behind it, so mounting the panel would just spin on a dead endpoint.
  const mockBackend = clientEnv.NEXT_PUBLIC_API_MODE === "mock"
  const stream = useAgentRunStream(runId, { enabled: enabled && !mockBackend })
  const [query, setQuery] = useState("")
  const [levelFilter, setLevelFilter] = useState<AgentStreamLevel | "all">("all")
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [kindFilter, setKindFilter] = useState<AgentStreamKind | "all">("all")
  const [atBottom, setAtBottom] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)

  const sources = useMemo(() => streamSources(stream.entries), [stream.entries])

  const filtered = useMemo(
    () =>
      filterAgentStreamEntries(stream.entries, {
        query,
        level: levelFilter,
        source: sourceFilter,
        kind: kindFilter,
      }),
    [stream.entries, query, levelFilter, sourceFilter, kindFilter],
  )

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance <= NEAR_BOTTOM_PX
    atBottomRef.current = nearBottom
    setAtBottom(nearBottom)
  }, [])

  // Auto-scroll on new/updated entries while the user is pinned to the bottom.
  // `filtered` gets a new identity whenever entries or filters change.
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [filtered])

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
  }, [])

  const cancellable =
    enabled &&
    (stream.status === "connecting" || stream.status === "live" || stream.status === "reconnecting")

  const cancel = async () => {
    setCancelling(true)
    await stream.cancel()
    setCancelling(false)
  }

  const resolveApproval = (approvalId: string, decision: "approved" | "rejected") =>
    stream.resolveApproval(approvalId, decision)

  // Under the mock adapter the stream endpoint does not exist — render nothing
  // rather than a panel stuck in "unavailable".
  if (mockBackend) return null

  const hasEntries = stream.entries.length > 0
  const showEmpty =
    hasEntries === false &&
    stream.status !== "connecting" &&
    stream.status !== "live" &&
    stream.status !== "reconnecting"

  return (
    <section className="app-panel app-stream-panel" aria-label="Live run log">
      <div className="app-panel-head">
        <div>
          <h2>Live log</h2>
          <p>
            Streaming events for this run. {statusLabel(stream.status)}
            {stream.lastEventAt ? ` · last event ${formatDateTime(stream.lastEventAt)}` : ""}
          </p>
        </div>
        <div className="app-stream-head-actions">
          <span
            className={`app-badge is-${stream.status === "live" ? "running" : stream.status === "done" ? "succeeded" : stream.status === "cancelled" ? "cancelled" : stream.status === "unavailable" ? "failed" : "queued"}`}
          >
            {statusLabel(stream.status)}
          </span>
          {cancellable ? (
            <button
              type="button"
              className="fm-btn fm-btn--danger"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          ) : null}
        </div>
      </div>

      {stream.error ? (
        <p className="app-stream-error">{humanizeStreamError(stream.error)}</p>
      ) : null}

      <div className="app-toolbar app-stream-filters">
        <label className="app-sort-field app-stream-search">
          <span className="sr-only">Filter log entries</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter messages…"
            aria-label="Filter log entries"
          />
        </label>
        <label className="app-sort-field">
          <span className="sr-only">Filter by level</span>
          <select
            value={levelFilter}
            onChange={(event) => setLevelFilter(event.target.value as typeof levelFilter)}
            aria-label="Filter by level"
          >
            {LEVELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="app-sort-field">
          <span className="sr-only">Filter by source</span>
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            aria-label="Filter by source"
          >
            <option value="all">All sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label className="app-sort-field">
          <span className="sr-only">Filter by type</span>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
            aria-label="Filter by type"
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="app-stream-scrollwrap">
        <div
          ref={scrollRef}
          className="app-stream-body"
          onScroll={handleScroll}
          role="log"
          aria-label="Run log entries"
          aria-live="off"
        >
          {filtered.map((entry) => {
            const approval = approvalInfo(entry)
            return (
              <div key={entry.id} className="app-stream-item">
                {approval ? (
                  <StreamApprovalCard
                    info={approval}
                    onResolve={(decision) => resolveApproval(approval.approvalId, decision)}
                  />
                ) : null}
                <StreamRow entry={entry} query={query.trim()} />
              </div>
            )
          })}

          {filtered.length === 0 ? (
            <p className="app-runlog-empty-steps">
              {showEmpty
                ? stream.status === "unavailable"
                  ? "Live stream is unavailable for this run."
                  : "Waiting for stream events…"
                : "No entries match the current filters."}
            </p>
          ) : null}
        </div>

        {!atBottom && filtered.length > 0 ? (
          <button type="button" className="app-stream-jump" onClick={jumpToBottom}>
            <ArrowDown aria-hidden="true" /> Jump to latest
          </button>
        ) : null}
      </div>
    </section>
  )
}
