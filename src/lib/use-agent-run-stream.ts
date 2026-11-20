"use client"

/**
 * React binding for the agent run log stream.
 *
 * Transport order per connection attempt:
 *   1. `EventSource` SSE at `/api/agent/runs/{runId}/stream`
 *   2. `WebSocket` fallback at the `ws(s)://` equivalent when SSE is
 *      unavailable or errors before the first event is received.
 *
 * Reconnects with exponential backoff (1s → 15s cap, ±20% jitter) until the
 * stream emits `done`, `cancel()` succeeds, the hook is disabled / unmounted,
 * or `MAX_RECONNECT_ATTEMPTS` consecutive failures are hit — at which point
 * the stream settles into `unavailable` instead of retrying forever (e.g.
 * when the backend has no `/stream` route at all). Parsed events fold into
 * the append-only `AgentStreamEntry[]` model via `reduceAgentStreamEntries`,
 * so each network event produces at most one state update and unchanged
 * reductions keep the same array ref.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import {
  cancelAgentRunRequest,
  parseStreamPayload,
  reduceAgentStreamEntries,
  resolveAgentApprovalRequest,
  resolveStreamApproval,
  type AgentApprovalDecision,
  type AgentStreamEntry,
} from "./agent-log-stream"

export type AgentStreamStatus =
  "idle" | "connecting" | "live" | "reconnecting" | "unavailable" | "done" | "cancelled"

export interface AgentRunStreamState {
  entries: AgentStreamEntry[]
  status: AgentStreamStatus
  /** ISO timestamp of the last received event, when any. */
  lastEventAt: string | null
  error: string | null
}

export interface AgentRunStreamHandle extends AgentRunStreamState {
  /** POST the run-cancel endpoint; reflects `cancelled` state on success. */
  cancel: () => Promise<boolean>
  /** POST an approval decision and patch the matching stream entry. */
  resolveApproval: (approvalId: string, decision: AgentApprovalDecision) => Promise<boolean>
  /** Close the stream and clear accumulated entries. */
  reset: () => void
}

interface TransportHandlers {
  onEvent: (eventName: string, data: string) => void
  onFailure: (reason: string) => void
}

interface Transport {
  close: () => void
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15_000
/** Consecutive transport failures tolerated before the stream goes `unavailable`. */
const MAX_RECONNECT_ATTEMPTS = 5
const SSE_EVENTS = ["log", "chunk", "approval", "status", "done", "error"] as const

/**
 * Map machine-readable transport failure reasons (`sse_error`,
 * `ws_closed_<code>`, …) to copy a user can act on. Server-provided error
 * strings pass through untouched.
 */
export function humanizeStreamError(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (reason === "sse_error") {
    return "The live event stream is unreachable — the server did not accept the connection."
  }
  if (reason === "ws_error") {
    return "The live event stream connection failed."
  }
  const wsClosed = /^ws_closed(?:_(\d+))?$/.exec(reason)
  if (wsClosed) {
    return wsClosed[1]
      ? `The live event stream disconnected (code ${wsClosed[1]}).`
      : "The live event stream closed unexpectedly."
  }
  return reason
}

function streamUrl(runId: string, websocket = false): string {
  const path = `/api/agent/runs/${encodeURIComponent(runId)}/stream`
  if (typeof window === "undefined") return path
  const url = new URL(path, window.location.origin)
  if (websocket) url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function openSseTransport(url: string, handlers: TransportHandlers): Transport | null {
  if (typeof EventSource === "undefined") return null
  const source = new EventSource(url)
  const listeners = SSE_EVENTS.map((name) => {
    const listener = (event: MessageEvent) => handlers.onEvent(name, String(event.data))
    source.addEventListener(name, listener)
    return [name, listener] as const
  })
  source.addEventListener("message", (event: MessageEvent) =>
    handlers.onEvent("log", String(event.data)),
  )
  source.onerror = () => handlers.onFailure("sse_error")
  return {
    close: () => {
      for (const [name, listener] of listeners) source.removeEventListener(name, listener)
      source.close()
    },
  }
}

function openWsTransport(url: string, handlers: TransportHandlers): Transport | null {
  if (typeof WebSocket === "undefined") return null
  let socket: WebSocket
  try {
    socket = new WebSocket(url)
  } catch {
    return null
  }
  socket.onmessage = (event: MessageEvent) => {
    const raw = typeof event.data === "string" ? event.data : ""
    if (raw === "") return
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const type = typeof parsed.type === "string" ? parsed.type : "message"
      handlers.onEvent(type, JSON.stringify(parsed))
    } catch {
      handlers.onEvent("log", raw)
    }
  }
  socket.onclose = (event) => {
    if (event.code === 1000) handlers.onFailure("ws_closed")
    else handlers.onFailure(`ws_closed_${event.code}`)
  }
  socket.onerror = () => handlers.onFailure("ws_error")
  return { close: () => socket.close(1000) }
}

/**
 * Subscribe to a run's event stream. Returns accumulated entries plus
 * connection status and control actions. When `enabled` is false the hook is
 * idle and holds no connection.
 */
export function useAgentRunStream(
  runId: string | undefined,
  options: { enabled?: boolean } = {},
): AgentRunStreamHandle {
  const enabled = options.enabled ?? true
  const [state, setState] = useState<AgentRunStreamState>({
    entries: [],
    status: "idle",
    lastEventAt: null,
    error: null,
  })

  const transportRef = useRef<Transport | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const sawEventRef = useRef(false)
  const wsOnlyRef = useRef(false)
  const closedByUserRef = useRef(false)
  const mountedRef = useRef(true)

  const closeTransport = useCallback(() => {
    // Detach before closing: a transport's close/error callback must never
    // observe (or tear down) a newer transport that has since taken its place.
    const transport = transportRef.current
    transportRef.current = null
    transport?.close()
  }, [])

  const pushEntry = useCallback((entry: AgentStreamEntry) => {
    setState((prev) => {
      const entries = reduceAgentStreamEntries(prev.entries, entry)
      if (entries === prev.entries) return prev
      return { ...prev, entries }
    })
  }, [])

  const ingest = useCallback(
    (eventName: string, data: string) => {
      const timestamp = new Date().toISOString()
      const entry = parseStreamPayload(data, eventName)
      if (!entry) return
      pushEntry(entry)
      if (entry.kind === "done") {
        // Mark as user-closed before tearing down so the transport's close
        // event doesn't schedule a reconnect.
        closedByUserRef.current = true
        setState((prev) => ({ ...prev, status: "done", lastEventAt: timestamp }))
        closeTransport()
        return
      }
      setState((prev) => ({ ...prev, status: "live", lastEventAt: timestamp }))
    },
    [pushEntry, closeTransport],
  )

  const scheduleRetry = useCallback((reason: string) => {
    if (!mountedRef.current || closedByUserRef.current) return
    attemptsRef.current += 1
    if (attemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
      // Give up cleanly: the endpoint is likely absent or permanently down.
      // Entries already received stay visible; no further transports open.
      setState((prev) => ({ ...prev, status: "unavailable", error: reason }))
      return
    }
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (attemptsRef.current - 1))
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    setState((prev) => ({
      ...prev,
      status: sawEventRef.current ? "reconnecting" : "connecting",
      error: reason,
    }))
    retryRef.current = setTimeout(() => {
      retryRef.current = null
      connectRef.current?.()
    }, delay)
  }, [])

  const connectRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    mountedRef.current = true
    if (!enabled || !runId) {
      setState({ entries: [], status: "idle", lastEventAt: null, error: null })
      return
    }

    closedByUserRef.current = false
    attemptsRef.current = 0
    sawEventRef.current = false
    wsOnlyRef.current = false

    let disposed = false

    const onTransportFailure = (reason: string) => {
      if (disposed || closedByUserRef.current) return
      const hadTransport = transportRef.current !== null
      closeTransport()
      // Before the first event, an SSE failure falls back to WebSocket once;
      // afterwards (or after WS already failed) we use backoff reconnects.
      if (!sawEventRef.current && !wsOnlyRef.current && hadTransport) {
        wsOnlyRef.current = true
        openWs()
        return
      }
      scheduleRetry(reason)
    }

    const sharedOnEvent = (eventName: string, data: string) => {
      sawEventRef.current = true
      // A delivered event proves the transport works — restart the
      // consecutive-failure count so the cap only trips on dead endpoints.
      attemptsRef.current = 0
      if (!disposed) ingest(eventName, data)
    }

    // Handlers are bound to the transport instance they were opened with so a
    // stale socket's late close/error can't tear down its replacement.
    // Returns false when no transport could be constructed at all.
    const openTransport = (open: (handlers: TransportHandlers) => Transport | null) => {
      if (disposed || closedByUserRef.current) return false
      let transport: Transport | null = null
      const handlers: TransportHandlers = {
        onEvent: sharedOnEvent,
        onFailure: (reason) => {
          if (!transport || transportRef.current !== transport) return
          onTransportFailure(reason)
        },
      }
      transport = open(handlers)
      if (!transport) return false
      transportRef.current = transport
      return true
    }

    const openWs = () => {
      const opened = openTransport((handlers) => openWsTransport(streamUrl(runId, true), handlers))
      if (!opened && !disposed && !closedByUserRef.current) {
        // No usable transport at all — surface it instead of retrying forever.
        setState((prev) => ({
          ...prev,
          status: "unavailable",
          error: "Neither EventSource nor WebSocket is available in this browser.",
        }))
      }
    }

    const connect = () => {
      if (disposed || closedByUserRef.current) return
      setState((prev) => ({
        ...prev,
        status: sawEventRef.current ? "reconnecting" : "connecting",
        error: null,
      }))
      if (wsOnlyRef.current) {
        openWs()
        return
      }
      const opened = openTransport((handlers) => openSseTransport(streamUrl(runId), handlers))
      if (opened) return
      // No EventSource — try WebSocket immediately.
      wsOnlyRef.current = true
      openWs()
    }

    connectRef.current = connect
    connect()

    return () => {
      disposed = true
      connectRef.current = null
      if (retryRef.current) {
        clearTimeout(retryRef.current)
        retryRef.current = null
      }
      closeTransport()
      mountedRef.current = false
    }
  }, [runId, enabled, ingest, closeTransport, scheduleRetry])

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!runId) return false
    const result = await cancelAgentRunRequest(runId)
    if (result.ok) {
      closedByUserRef.current = true
      closeTransport()
      if (retryRef.current) {
        clearTimeout(retryRef.current)
        retryRef.current = null
      }
      setState((prev) => ({ ...prev, status: "cancelled", error: null }))
      return true
    }
    setState((prev) => ({ ...prev, error: result.error }))
    return false
  }, [runId, closeTransport])

  const resolveApproval = useCallback(
    async (approvalId: string, decision: AgentApprovalDecision): Promise<boolean> => {
      if (!runId) return false
      const result = await resolveAgentApprovalRequest(runId, approvalId, decision)
      if (!result.ok) {
        setState((prev) => ({ ...prev, error: result.error }))
        return false
      }
      setState((prev) => ({
        ...prev,
        entries: resolveStreamApproval(prev.entries, approvalId, decision),
      }))
      return true
    },
    [runId],
  )

  const reset = useCallback(() => {
    closedByUserRef.current = true
    closeTransport()
    if (retryRef.current) {
      clearTimeout(retryRef.current)
      retryRef.current = null
    }
    attemptsRef.current = 0
    sawEventRef.current = false
    wsOnlyRef.current = false
    setState({ entries: [], status: "idle", lastEventAt: null, error: null })
  }, [closeTransport])

  return { ...state, cancel, resolveApproval, reset }
}
