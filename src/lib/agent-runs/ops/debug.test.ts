import { describe, expect, it } from "vitest"

import {
  advanceDebugPlayback,
  createAgentRunDebugState,
  currentDebugEntry,
  describeDebugEvent,
  firstDebugEvent,
  jumpToDebugBreakpoint,
  lastDebugEvent,
  matchesDebugBreakpoint,
  searchRunEvents,
  stepDebugCursor,
  toggleDebugBreakpoint,
  toggleDebugPlaying,
} from "./debug"
import { buildOpsEvent, buildOpsRun } from "./fixtures"

describe("debug state", () => {
  it("creates a state at the first event", () => {
    const run = buildOpsRun()
    const state = createAgentRunDebugState(run)
    expect(state.cursor).toBe(0)
    expect(currentDebugEntry(run, state)?.id).toBe("e1")
  })

  it("handles runs with no events", () => {
    const run = buildOpsRun({ events: [] })
    const state = createAgentRunDebugState(run)
    expect(state.cursor).toBe(-1)
    expect(currentDebugEntry(run, state)).toBeNull()
  })

  it("steps forward and backward, clamped at edges", () => {
    const run = buildOpsRun()
    let state = createAgentRunDebugState(run)
    state = stepDebugCursor(state, run, 1)
    expect(state.cursor).toBe(1)
    state = stepDebugCursor(state, run, -1)
    expect(state.cursor).toBe(0)
    state = stepDebugCursor(state, run, -1)
    expect(state.cursor).toBe(0) // clamped
    expect(stepDebugCursor(state, run, -1)).toBe(state) // same ref at edge
  })

  it("jumps to first/last", () => {
    const run = buildOpsRun()
    let state = createAgentRunDebugState(run)
    state = lastDebugEvent(state, run)
    expect(state.cursor).toBe(run.events.length - 1)
    state = firstDebugEvent(state, run)
    expect(state.cursor).toBe(0)
  })

  it("toggles playing and stops at breakpoints during playback", () => {
    const run = buildOpsRun()
    let state = createAgentRunDebugState(run, { breakpoints: ["status"] })
    state = toggleDebugPlaying(state, run)
    expect(state.playing).toBe(true)
    // e1 (cursor 0) -> e2 is kind "status" => breakpoint, playback pauses there.
    state = advanceDebugPlayback(state, run)
    expect(state.cursor).toBe(1)
    expect(state.playing).toBe(false)
    // Resume manually; next advance should not pause until another match.
    state = toggleDebugPlaying(state, run)
    state = advanceDebugPlayback(state, run)
    expect(state.cursor).toBe(2)
    expect(state.playing).toBe(true)
    state = advanceDebugPlayback(state, run)
    expect(state.playing).toBe(false) // ran off the end
  })

  it("jumpToDebugBreakpoint finds next match in either direction", () => {
    const run = buildOpsRun({
      events: [
        buildOpsEvent({ id: "a", kind: "log" }),
        buildOpsEvent({ id: "b", kind: "error", level: "error" }),
        buildOpsEvent({ id: "c", kind: "log" }),
        buildOpsEvent({ id: "d", kind: "done" }),
      ],
    })
    const state = createAgentRunDebugState(run, { breakpoints: ["error"], cursor: 0 })
    const jumped = jumpToDebugBreakpoint(state, run, 1)
    expect(jumped?.cursor).toBe(1)
    const back = jumpToDebugBreakpoint(jumped!, run, -1)
    expect(back).toBeNull() // nothing before index 1
    expect(jumpToDebugBreakpoint(state, run, 1)!.playing).toBe(false)
    expect(jumpToDebugBreakpoint(createAgentRunDebugState(run), run)).toBeNull() // no breakpoints
  })

  it("toggles breakpoints immutably", () => {
    const run = buildOpsRun()
    let state = createAgentRunDebugState(run)
    state = toggleDebugBreakpoint(state, "error")
    expect(state.breakpoints).toEqual(["error"])
    state = toggleDebugBreakpoint(state, "error")
    expect(state.breakpoints).toEqual([])
  })

  it("matches breakpoints against kind, level, and source", () => {
    const entry = buildOpsEvent({ kind: "log", level: "warn", source: "tool" })
    expect(matchesDebugBreakpoint(entry, ["warn"])).toBe(true)
    expect(matchesDebugBreakpoint(entry, ["tool"])).toBe(true)
    expect(matchesDebugBreakpoint(entry, ["error"])).toBe(false)
    expect(matchesDebugBreakpoint(entry, [])).toBe(false)
  })
})

describe("event inspector", () => {
  it("describes an event with payload details", () => {
    const entry = buildOpsEvent({
      data: { path: "docs/methods.md", lines: 42 },
    })
    const desc = describeDebugEvent(entry, 3, ["log"])
    expect(desc.index).toBe(3)
    expect(desc.payloadJson).toContain("docs/methods.md")
    expect(desc.payloadBytes).toBeGreaterThan(0)
    expect(desc.isBreakpoint).toBe(true)
  })

  it("handles events without data", () => {
    const desc = describeDebugEvent(buildOpsEvent(), 0)
    expect(desc.payloadJson).toBeNull()
    expect(desc.payloadBytes).toBe(0)
    expect(desc.isBreakpoint).toBe(false)
  })

  it("searches events by message, source, kind, id", () => {
    const run = buildOpsRun({
      events: [
        buildOpsEvent({ id: "a", message: "Compiling assets" }),
        buildOpsEvent({ id: "b", message: "Done", source: "tool" }),
      ],
    })
    expect(searchRunEvents(run, "compiling")).toHaveLength(1)
    expect(searchRunEvents(run, "tool")).toHaveLength(1)
    expect(searchRunEvents(run, "")).toHaveLength(2)
    expect(searchRunEvents(run, "zzz")).toHaveLength(0)
  })
})
