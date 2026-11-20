/**
 * Agent run log streaming — transport-agnostic core.
 *
 * This module is deliberately free of React and DOM dependencies so the SSE
 * parser, event normalization, append-only reducer, and live filters can be
 * unit-tested in isolation. The React hook that wires it to EventSource /
 * WebSocket lives in `src/lib/use-agent-run-stream.ts`.
 *
 * Wire contract (assumed — no backend route exists yet):
 *   GET  /api/agent/runs/{runId}/stream        → `text/event-stream`
 *        event types: `log`, `chunk`, `approval`, `status`, `done`, `error`
 *        each `data:` payload is a JSON object (see `parseStreamPayload`).
 *   WS   fallback: same URL upgraded to `ws(s)://`, each text frame is one
 *        JSON event object `{ type, ... }`.
 *   POST /api/agent/runs/{runId}/cancel                    → 204
 *   POST /api/agent/runs/{runId}/approvals/{approvalId}    → `{ decision }`
 */

export type AgentStreamLevel = "debug" | "info" | "warn" | "error"

export type AgentStreamKind = "log" | "chunk" | "approval_required" | "status" | "done" | "error"

/** Normalized log entry produced by the stream reducer. */
export interface AgentStreamEntry {
  /** Stable id; `chunk` events target an existing entry by this id. */
  id: string
  /** ISO-8601 timestamp of when the event was received/parsed. */
  timestamp: string
  level: AgentStreamLevel
  /** Origin of the entry, e.g. "agent", "tool", "system". */
  source: string
  kind: AgentStreamKind
  message: string
  /** Structured payload — tool args, approval details, run status, etc. */
  data?: Record<string, unknown>
}

export interface AgentStreamFilter {
  /** Case-insensitive substring matched against message and source. */
  query?: string
  level?: AgentStreamLevel | "all"
  source?: string | "all"
  kind?: AgentStreamKind | "all"
}

export type AgentApprovalDecision = "approved" | "rejected"

/* ------------------------------------------------------------------------ */
/* SSE parsing                                                               */
/* ------------------------------------------------------------------------ */

export interface SseEvent {
  /** SSE `event:` field, or "message" when absent. */
  event: string
  /** Concatenated `data:` lines (joined with "\n"). */
  data: string
  /** SSE `id:` field, when present. */
  id?: string
}

/**
 * Incremental Server-Sent Events parser. Feed arbitrary text chunks with
 * `push()`; complete events are returned in order. `end()` flushes a final
 * event that was not terminated by a blank line.
 *
 * Handles `\n`, `\r\n`, and lone `\r` line endings, multi-line `data:` fields,
 * and ignores `retry:` / comment (`:`) lines.
 */
export class SseParser {
  private buffer = ""
  private dataLines: string[] = []
  private eventType = "message"
  private eventId: string | undefined
  private sawField = false

  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []
    // Normalize nothing up front — split lazily so a trailing partial line
    // stays in the buffer until its terminator arrives.
    let start = 0
    for (let i = 0; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i]
      const isBreak = ch === "\n" || ch === "\r"
      if (!isBreak) continue
      const line = this.buffer.slice(start, i)
      start = i + 1
      if (ch === "\r" && this.buffer[i + 1] === "\n") {
        start = i + 2
        i += 1
      }
      const event = this.consumeLine(line)
      if (event) events.push(event)
    }
    this.buffer = this.buffer.slice(start)
    return events
  }

  end(): SseEvent[] {
    const events: SseEvent[] = []
    if (this.buffer.length > 0) {
      const event = this.consumeLine(this.buffer)
      this.buffer = ""
      if (event) events.push(event)
    }
    const flushed = this.flushEvent()
    if (flushed) events.push(flushed)
    return events
  }

  private consumeLine(line: string): SseEvent | null {
    if (line === "") return this.flushEvent()
    if (line.startsWith(":")) return null // comment / keep-alive
    this.sawField = true
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "data") this.dataLines.push(value)
    else if (field === "event") this.eventType = value || "message"
    else if (field === "id") this.eventId = value
    // `retry:` and unknown fields are ignored.
    return null
  }

  private flushEvent(): SseEvent | null {
    if (!this.sawField && this.dataLines.length === 0) {
      this.reset()
      return null
    }
    const event: SseEvent = {
      event: this.eventType,
      data: this.dataLines.join("\n"),
      ...(this.eventId !== undefined ? { id: this.eventId } : {}),
    }
    this.reset()
    return event
  }

  private reset() {
    this.dataLines = []
    this.eventType = "message"
    this.eventId = undefined
    this.sawField = false
  }
}

/* ------------------------------------------------------------------------ */
/* Event normalization                                                       */
/* ------------------------------------------------------------------------ */

const LEVELS: readonly AgentStreamLevel[] = ["debug", "info", "warn", "error"]

const EVENT_KIND_MAP: Record<string, AgentStreamKind> = {
  log: "log",
  chunk: "chunk",
  message: "log",
  approval: "approval_required",
  approval_required: "approval_required",
  status: "status",
  done: "done",
  end: "done",
  finish: "done",
  error: "error",
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asLevel(value: unknown): AgentStreamLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value)
    ? (value as AgentStreamLevel)
    : "info"
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

let fallbackCounter = 0
function nextEntryId(): string {
  fallbackCounter += 1
  return `evt_${Date.now().toString(36)}_${fallbackCounter.toString(36)}`
}

/** Test hook — resets the id fallback counter between tests. */
export function resetStreamIdCounter() {
  fallbackCounter = 0
}

/**
 * Normalize one raw stream payload into an `AgentStreamEntry`.
 *
 * Accepts either a JSON string or an already-parsed object. Recognized fields:
 * `id`, `timestamp`/`at`/`time`, `level`, `source`/`origin`, `type`/`kind`,
 * `message`/`text`/`content`, `data`/`payload`, plus approval fields
 * (`approvalId`, `action`, `summary`, `status`) for `approval` events.
 *
 * Returns `null` for payloads that cannot be interpreted as a log event.
 */
export function parseStreamPayload(
  raw: string | Record<string, unknown>,
  eventType?: string,
): AgentStreamEntry | null {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed === "") return null
    try {
      obj = asRecord(JSON.parse(trimmed))
    } catch {
      // Plain-text SSE data is treated as a log message.
      obj = { message: trimmed }
    }
  } else {
    obj = asRecord(raw)
  }
  if (!obj) return null

  const typeField = asString(obj.type) ?? asString(obj.kind) ?? eventType ?? "log"
  const kind = EVENT_KIND_MAP[typeField] ?? "log"

  const message = asString(obj.message) ?? asString(obj.text) ?? asString(obj.content) ?? typeField

  const dataParts: Record<string, unknown> = {}
  const data = asRecord(obj.data) ?? asRecord(obj.payload)
  if (data) Object.assign(dataParts, data)
  // Approval fields are lifted into `data` so cards can render without
  // knowing the exact payload shape.
  for (const key of ["approvalId", "action", "summary", "status", "runId", "runStatus"]) {
    if (obj[key] !== undefined) dataParts[key] = obj[key]
  }

  return {
    id: asString(obj.id) ?? nextEntryId(),
    timestamp: asString(obj.timestamp) ?? asString(obj.at) ?? new Date().toISOString(),
    level: kind === "error" ? "error" : asLevel(obj.level ?? obj.severity),
    source: asString(obj.source) ?? asString(obj.origin) ?? "agent",
    kind,
    message,
    ...(Object.keys(dataParts).length > 0 ? { data: dataParts } : {}),
  }
}

/* ------------------------------------------------------------------------ */
/* Append-only reducer                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Fold one parsed entry into the entries array.
 *
 * - `chunk` events append their message to the entry sharing their `id`
 *   (token streaming); if no entry matches, the chunk becomes a new entry.
 * - Non-chunk events with a duplicate `id` are ignored (idempotent reconnects).
 * - Returns the *same array reference* when nothing changed so memoized
 *   consumers can skip re-rendering.
 */
export function reduceAgentStreamEntries(
  entries: readonly AgentStreamEntry[],
  entry: AgentStreamEntry,
): AgentStreamEntry[] {
  if (entry.kind === "chunk") {
    const index = entries.findIndex((existing) => existing.id === entry.id)
    if (index === -1) return [...entries, entry]
    const target = entries[index]
    const next = entries.slice()
    next[index] = { ...target, message: target.message + entry.message }
    return next
  }

  if (entries.some((existing) => existing.id === entry.id)) return entries as AgentStreamEntry[]
  return [...entries, entry]
}

/**
 * Apply an approval decision to every `approval_required` entry whose
 * `data.approvalId` (or `data.id`) matches. Entries keep their position;
 * resolved entries carry `data.status = decision`.
 */
export function resolveStreamApproval(
  entries: readonly AgentStreamEntry[],
  approvalId: string,
  decision: AgentApprovalDecision,
): AgentStreamEntry[] {
  let changed = false
  const next = entries.map((entry) => {
    if (entry.kind !== "approval_required" || !entry.data) return entry
    const id = entry.data.approvalId ?? entry.data.id
    if (id !== approvalId) return entry
    if (
      entry.data.status === decision ||
      entry.data.status === "approved" ||
      entry.data.status === "rejected"
    ) {
      return entry
    }
    changed = true
    return { ...entry, data: { ...entry.data, status: decision } }
  })
  return changed ? next : (entries as AgentStreamEntry[])
}

/* ------------------------------------------------------------------------ */
/* Live filtering + highlighting                                             */
/* ------------------------------------------------------------------------ */

export function filterAgentStreamEntries(
  entries: readonly AgentStreamEntry[],
  filter: AgentStreamFilter,
): AgentStreamEntry[] {
  const query = filter.query?.trim().toLowerCase()
  const level = filter.level && filter.level !== "all" ? filter.level : null
  const source = filter.source && filter.source !== "all" ? filter.source : null
  const kind = filter.kind && filter.kind !== "all" ? filter.kind : null

  if (!query && !level && !source && !kind) return entries as AgentStreamEntry[]

  return entries.filter((entry) => {
    if (level && entry.level !== level) return false
    if (source && entry.source !== source) return false
    if (kind && entry.kind !== kind) return false
    if (query) {
      const haystack = `${entry.message}\n${entry.source}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

/** Distinct sources present in the entries, for the filter dropdown. */
export function streamSources(entries: readonly AgentStreamEntry[]): string[] {
  const seen = new Set<string>()
  for (const entry of entries) seen.add(entry.source)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export interface HighlightRange {
  start: number
  end: number
}

/**
 * Case-insensitive, non-overlapping match ranges of `query` inside `text`.
 * Returns an empty array for empty queries. Used to render `<mark>` highlights
 * without splitting strings in the hot render path more than necessary.
 */
export function highlightRanges(text: string, query: string): HighlightRange[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const haystack = text.toLowerCase()
  const ranges: HighlightRange[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) break
    ranges.push({ start: index, end: index + needle.length })
    from = index + needle.length
  }
  return ranges
}

/* ------------------------------------------------------------------------ */
/* Control-plane requests (cancel + approvals)                               */
/* ------------------------------------------------------------------------ */

export type StreamRequestResult = { ok: true } | { ok: false; error: string }

async function postJson(url: string, body: Record<string, unknown>): Promise<StreamRequestResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (response.ok) return { ok: true }
    let message = `Request failed (${response.status}).`
    try {
      const payload = (await response.json()) as { error?: string; message?: string }
      message = payload.error ?? payload.message ?? message
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    return { ok: false, error: message }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network request failed.",
    }
  }
}

/**
 * POST `/api/agent/runs/{runId}/cancel`. Never throws — callers reflect the
 * `cancelled` state locally only when `ok` is true, and surface `error`
 * otherwise (e.g. while the endpoint is still being provisioned).
 */
export function cancelAgentRunRequest(runId: string): Promise<StreamRequestResult> {
  return postJson(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {})
}

/**
 * POST `/api/agent/runs/{runId}/approvals/{approvalId}` with
 * `{ decision: "approved" | "rejected" }`. Same never-throw contract.
 */
export function resolveAgentApprovalRequest(
  runId: string,
  approvalId: string,
  decision: AgentApprovalDecision,
): Promise<StreamRequestResult> {
  return postJson(
    `/api/agent/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    { decision },
  )
}
