"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bug,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipForward,
} from "lucide-react"

import {
  advanceDebugPlayback,
  createAgentRunDebugState,
  currentDebugEntry,
  describeDebugEvent,
  firstDebugEvent,
  jumpToDebugBreakpoint,
  lastDebugEvent,
  searchRunEvents,
  stepDebugCursor,
  toggleDebugBreakpoint,
  toggleDebugPlaying,
  type AgentRunDebugState,
} from "@/lib/agent-runs/ops/debug"
import type { AgentRunRecord } from "@/lib/agent-runs/ops/types"

const BREAKPOINT_OPTIONS = ["log", "chunk", "approval_required", "status", "done", "error"] as const

/**
 * Debug panel for a recorded run: event inspector, breakpoints on event
 * kinds, payload viewer, and step-through/playback controls over the
 * normalized event stream.
 */
export function AgentRunDebugPanel({ run }: { run: AgentRunRecord }) {
  const [state, setState] = useState<AgentRunDebugState>(() => createAgentRunDebugState(run))
  const [query, setQuery] = useState("")

  // Reset cursor when the run identity changes (run.id is the stable key;
  // the full run object may be re-created by the parent on each fetch).
  useEffect(() => {
    setState(createAgentRunDebugState(run))
    setQuery("")
  }, [run.id])

  // Playback tick — 400ms per event while playing.
  useEffect(() => {
    if (!state.playing) return
    const timer = window.setInterval(() => {
      setState((s) => advanceDebugPlayback(s, run))
    }, 400)
    return () => window.clearInterval(timer)
  }, [state.playing, run])

  const entry = currentDebugEntry(run, state)
  const descriptor = useMemo(
    () => (entry ? describeDebugEvent(entry, state.cursor, state.breakpoints) : null),
    [entry, state.cursor, state.breakpoints],
  )

  const visible = useMemo(() => searchRunEvents(run, query), [run, query])

  const jumpToEvent = (index: number) => {
    setState((s) => ({ ...s, cursor: index, playing: false }))
  }

  const runToBreakpoint = (direction: 1 | -1 = 1) => {
    setState((s) => jumpToDebugBreakpoint(s, run, direction) ?? s)
  }

  return (
    <section className="app-panel" aria-labelledby="debug-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="debug-heading">
            <Bug aria-hidden="true" className="app-panel-icon" /> Debug
          </h2>
          <p>
            {run.events.length} event{run.events.length === 1 ? "" : "s"} — step through the
            recorded stream, set breakpoints, inspect payloads.
          </p>
        </div>
        <div className="app-debug-breakpoints" role="group" aria-label="Breakpoints">
          {BREAKPOINT_OPTIONS.map((kind) => {
            const active = state.breakpoints.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                className={`app-debug-bp${active ? "is-active" : ""}`}
                aria-pressed={active}
                onClick={() => setState((s) => toggleDebugBreakpoint(s, kind))}
              >
                {kind}
              </button>
            )
          })}
        </div>
      </div>

      <div className="app-debug-controls">
        <button
          type="button"
          className="fm-btn"
          onClick={() => setState((s) => firstDebugEvent(s, run))}
          disabled={run.events.length === 0}
          aria-label="First event"
        >
          <ChevronFirst aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={() => setState((s) => stepDebugCursor(s, run, -1))}
          disabled={run.events.length === 0 || state.cursor <= 0}
          aria-label="Previous event"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={() => setState((s) => toggleDebugPlaying(s, run))}
          disabled={run.events.length === 0}
          aria-label={state.playing ? "Pause" : "Play"}
        >
          {state.playing ? (
            <Pause aria-hidden="true" className="size-4" />
          ) : (
            <Play aria-hidden="true" className="size-4" />
          )}
          {state.playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={() => setState((s) => stepDebugCursor(s, run, 1))}
          disabled={run.events.length === 0 || state.cursor >= run.events.length - 1}
          aria-label="Next event"
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={() => setState((s) => lastDebugEvent(s, run))}
          disabled={run.events.length === 0}
          aria-label="Last event"
        >
          <ChevronLast aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="fm-btn"
          onClick={() => runToBreakpoint(1)}
          disabled={state.breakpoints.length === 0}
          title="Advance to the next breakpoint"
        >
          <SkipForward aria-hidden="true" className="size-4" /> To breakpoint
        </button>
        <span className="app-debug-position" role="status">
          {run.events.length === 0
            ? "no events"
            : `event ${state.cursor + 1} / ${run.events.length}`}
        </span>
      </div>

      {descriptor ? (
        <div className="app-debug-inspector">
          <div className="app-debug-inspector-head">
            <span className={`app-badge is-${descriptor.level}`}>{descriptor.kind}</span>
            <span className="app-badge">{descriptor.level}</span>
            <span className="app-badge">{descriptor.source}</span>
            {descriptor.isBreakpoint ? (
              <span className="app-badge is-running">breakpoint</span>
            ) : null}
            <code className="app-debug-event-id">{descriptor.id}</code>
          </div>
          <p className="app-debug-message">{descriptor.message}</p>
          <dl className="app-runlog-step-facts">
            <div>
              <dt>Timestamp</dt>
              <dd>{descriptor.timestamp}</dd>
            </div>
            <div>
              <dt>Payload size</dt>
              <dd>{descriptor.payloadBytes} B</dd>
            </div>
          </dl>
          {descriptor.payloadJson ? (
            <pre className="app-runlog-payload">{descriptor.payloadJson}</pre>
          ) : null}
        </div>
      ) : (
        <p className="app-runlog-empty-steps">No event at the cursor.</p>
      )}

      <div className="app-debug-event-list">
        <input
          type="search"
          className="app-mkt-search"
          placeholder="Filter events…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter debug events"
        />
        <ol className="app-debug-events">
          {visible.map(({ index, entry: ev }) => (
            <li key={`${ev.id}-${index}`}>
              <button
                type="button"
                className={`app-debug-event${index === state.cursor ? "is-current" : ""}`}
                onClick={() => jumpToEvent(index)}
              >
                <span className="app-debug-event-index">{index + 1}</span>
                <span className={`app-badge is-${ev.level}`}>{ev.kind}</span>
                <span className="app-debug-event-message">{ev.message}</span>
                <span className="app-debug-event-time">{ev.timestamp.slice(11, 19)}</span>
              </button>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="app-runlog-empty-steps">No events match the filter.</li>
          ) : null}
        </ol>
      </div>
    </section>
  )
}
