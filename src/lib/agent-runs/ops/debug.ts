/**
 * Agent run debugging — client-side inspection and step-through for recorded
 * runs.
 *
 * A `AgentRunDebugState` is a cursor into the run's normalized event stream
 * plus a set of breakpoints keyed by event kind ("log", "chunk",
 * "approval_required", "status", "done", "error") or raw type string. The
 * reducer-style helpers are pure so the debug panel component can drive them
 * with React state; `jumpToBreakpoint` implements "run to next breakpoint".
 */

import type { AgentStreamEntry } from "@/lib/agent-log-stream"

import type { AgentRunRecord } from "./types"

export type DebugBreakpoint = string

export interface AgentRunDebugState {
  /** Index into `run.events`; -1 means "before the first event". */
  cursor: number
  /** Event kinds/types that act as breakpoints. */
  breakpoints: DebugBreakpoint[]
  /** Whether auto-advance ("play") is active. */
  playing: boolean
}

export function createAgentRunDebugState(
  run: Pick<AgentRunRecord, "events">,
  options: { breakpoints?: DebugBreakpoint[]; cursor?: number } = {},
): AgentRunDebugState {
  const cursor = options.cursor ?? (run.events.length > 0 ? 0 : -1)
  return {
    cursor: clampDebugCursor(cursor, run.events.length),
    breakpoints: [...(options.breakpoints ?? [])],
    playing: false,
  }
}

export function clampDebugCursor(cursor: number, eventCount: number): number {
  if (eventCount <= 0) return -1
  return Math.min(eventCount - 1, Math.max(0, cursor))
}

export function currentDebugEntry(
  run: Pick<AgentRunRecord, "events">,
  state: AgentRunDebugState,
): AgentStreamEntry | null {
  if (state.cursor < 0 || state.cursor >= run.events.length) return null
  return run.events[state.cursor] ?? null
}

function withCursor(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
  cursor: number,
  playing = false,
): AgentRunDebugState {
  return {
    ...state,
    cursor: clampDebugCursor(cursor, run.events.length),
    playing,
  }
}

/** Step one event forward/back; returns the same state object at the edges. */
export function stepDebugCursor(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
  direction: 1 | -1,
): AgentRunDebugState {
  const next = state.cursor + direction
  const clamped = clampDebugCursor(next, run.events.length)
  if (clamped === state.cursor) return state
  return withCursor(state, run, clamped)
}

export function firstDebugEvent(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
): AgentRunDebugState {
  return withCursor(state, run, 0)
}

export function lastDebugEvent(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
): AgentRunDebugState {
  return withCursor(state, run, run.events.length - 1)
}

export function toggleDebugPlaying(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
): AgentRunDebugState {
  // Never "play" past the end; starting playback from the end rewinds to 0.
  const cursor =
    !state.playing && state.cursor >= run.events.length - 1 && run.events.length > 0
      ? 0
      : state.cursor
  return withCursor(state, run, cursor, !state.playing)
}

/** Advance one tick during playback; pauses automatically at breakpoints. */
export function advanceDebugPlayback(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
): AgentRunDebugState {
  if (!state.playing) return state
  const next = state.cursor + 1
  if (next >= run.events.length) {
    return withCursor(state, run, run.events.length - 1, false)
  }
  const entry = run.events[next]
  const paused = entry ? matchesDebugBreakpoint(entry, state.breakpoints) : false
  return withCursor(state, run, next, !paused)
}

/** Does this entry match any configured breakpoint? */
export function matchesDebugBreakpoint(
  entry: Pick<AgentStreamEntry, "kind" | "level" | "source"> & { type?: string },
  breakpoints: readonly DebugBreakpoint[],
): boolean {
  if (breakpoints.length === 0) return false
  const candidates = new Set<string>([entry.kind, entry.level, entry.source])
  if (entry.type) candidates.add(entry.type)
  return breakpoints.some((bp) => candidates.has(bp))
}

/**
 * "Run to next breakpoint": scan forward (or backward with direction -1) from
 * the cursor for the next entry matching a breakpoint. Returns null state
 * fields unchanged when no breakpoint exists ahead — caller can fall back to
 * stepping. Pauses playback on arrival.
 */
export function jumpToDebugBreakpoint(
  state: AgentRunDebugState,
  run: Pick<AgentRunRecord, "events">,
  direction: 1 | -1 = 1,
): AgentRunDebugState | null {
  if (state.breakpoints.length === 0 || run.events.length === 0) return null
  let index = state.cursor + direction
  while (index >= 0 && index < run.events.length) {
    const entry = run.events[index]
    if (entry && matchesDebugBreakpoint(entry, state.breakpoints)) {
      return withCursor(state, run, index, false)
    }
    index += direction
  }
  return null
}

export function toggleDebugBreakpoint(
  state: AgentRunDebugState,
  breakpoint: DebugBreakpoint,
): AgentRunDebugState {
  const has = state.breakpoints.includes(breakpoint)
  return {
    ...state,
    breakpoints: has
      ? state.breakpoints.filter((bp) => bp !== breakpoint)
      : [...state.breakpoints, breakpoint],
  }
}

/* ------------------------------------------------------------------------ */
/* Event inspector                                                           */
/* ------------------------------------------------------------------------ */

export interface DebugEventDescriptor {
  id: string
  timestamp: string
  kind: string
  level: string
  source: string
  message: string
  /** Pretty-printed JSON of `data`, or null when absent. */
  payloadJson: string | null
  /** Serialized payload size in bytes (0 when absent). */
  payloadBytes: number
  /** Index of the event in the run's event list. */
  index: number
  isBreakpoint: boolean
}

/** Describe one event for the inspector panel. */
export function describeDebugEvent(
  entry: AgentStreamEntry,
  index: number,
  breakpoints: readonly DebugBreakpoint[] = [],
): DebugEventDescriptor {
  let payloadJson: string | null = null
  let payloadBytes = 0
  if (entry.data && Object.keys(entry.data).length > 0) {
    try {
      payloadJson = JSON.stringify(entry.data, null, 2)
      payloadBytes = new TextEncoder().encode(payloadJson).length
    } catch {
      payloadJson = null
    }
  }
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    kind: entry.kind,
    level: entry.level,
    source: entry.source,
    message: entry.message,
    payloadJson,
    payloadBytes,
    index,
    isBreakpoint: matchesDebugBreakpoint(entry, breakpoints),
  }
}

/** Filter run events by a case-insensitive query over message/source/kind. */
export function searchRunEvents(
  run: Pick<AgentRunRecord, "events">,
  query: string,
): { index: number; entry: AgentStreamEntry }[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return run.events.map((entry, index) => ({ index, entry }))
  return run.events
    .map((entry, index) => ({ index, entry }))
    .filter(({ entry }) =>
      `${entry.message}\n${entry.source}\n${entry.kind}\n${entry.id}`
        .toLowerCase()
        .includes(needle),
    )
}
