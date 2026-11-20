import type { AgentRun, AgentRunEvent } from "./types"

/** Shared test fixture builders for the agent-runs core suite. */

export function makeEvent(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return {
    id: "e1",
    seq: 1,
    timestamp: "2026-11-19T12:00:00.000Z",
    type: "step",
    name: "step.one",
    ...overrides,
  }
}

export function makeEvents(count: number, base: Partial<AgentRunEvent> = {}): AgentRunEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent({
      id: `e${i + 1}`,
      seq: i + 1,
      timestamp: new Date(Date.parse("2026-11-19T12:00:00.000Z") + i * 1000).toISOString(),
      name: `step.${i}`,
      ...base,
    }),
  )
}

export function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run_1",
    title: "Test run",
    prompt: "Summarize the quarterly report",
    model: "gpt-4o",
    status: "completed",
    events: [makeEvent()],
    metrics: {},
    checkpoints: [],
    createdAt: "2026-11-19T12:00:00.000Z",
    updatedAt: "2026-11-19T12:00:00.000Z",
    ...overrides,
  }
}
