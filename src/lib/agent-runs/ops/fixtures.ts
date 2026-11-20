/**
 * Deterministic sample run factory shared by ops tests and component tests.
 * Not part of the runtime API — safe to import anywhere in tests/stories.
 */

import type { AgentStreamEntry } from "@/lib/agent-log-stream"

import type { AgentRunOpsStep, AgentRunRecord } from "./types"

export function buildOpsStep(overrides: Partial<AgentRunOpsStep> = {}): AgentRunOpsStep {
  return {
    id: "step_1",
    kind: "thought",
    title: "Planned the work",
    detail: "Read the inputs first.",
    status: "done",
    startedAt: "2026-11-19T09:30:01.000Z",
    endedAt: "2026-11-19T09:30:02.000Z",
    durationMs: 1000,
    ...overrides,
  }
}

export function buildOpsEvent(overrides: Partial<AgentStreamEntry> = {}): AgentStreamEntry {
  return {
    id: "evt_1",
    timestamp: "2026-11-19T09:30:01.000Z",
    level: "info",
    source: "agent",
    kind: "log",
    message: "Step started",
    ...overrides,
  }
}

export function buildOpsRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run_ops_01",
    prompt: "Draft the methods section",
    status: "succeeded",
    model: "writer-small",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    actor: "tester",
    createdAt: "2026-11-19T09:30:00.000Z",
    startedAt: "2026-11-19T09:30:01.000Z",
    finishedAt: "2026-11-19T09:34:00.000Z",
    steps: [
      buildOpsStep({ id: "s1", title: "Planned the draft", durationMs: 1200 }),
      buildOpsStep({
        id: "s2",
        kind: "tool_call",
        title: "Write docs/methods.md",
        detail: "Wrote the methods section.",
        startedAt: "2026-11-19T09:30:03.000Z",
        durationMs: 9000,
        payload: { path: "docs/methods.md" },
      }),
      buildOpsStep({
        id: "s3",
        kind: "result",
        title: "Summarized output",
        startedAt: "2026-11-19T09:30:13.000Z",
        durationMs: 500,
      }),
    ],
    events: [
      buildOpsEvent({ id: "e1", message: "Run started" }),
      buildOpsEvent({
        id: "e2",
        kind: "status",
        message: "Running",
        data: { runStatus: "running" },
      }),
      buildOpsEvent({ id: "e3", kind: "done", level: "info", message: "Run finished" }),
    ],
    metrics: { model: "writer-small", inputTokens: 1200, outputTokens: 800, costUsd: 0.012 },
    tags: ["docs"],
    retentionDays: 90,
    summary: "Done.",
    ...overrides,
  }
}
