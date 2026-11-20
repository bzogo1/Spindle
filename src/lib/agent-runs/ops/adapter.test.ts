import { describe, expect, it } from "vitest"

import type { AgentRun, AgentRunEvent } from "@/lib/agent-runs/core/types"

import { coreRunToOpsRecord, coreStatusToOpsStatus } from "./adapter"

function coreEvent(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return {
    id: "evt_1",
    seq: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "step",
    name: "plan",
    summary: "Planned",
    ...overrides,
  }
}

function coreRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "core_run_1",
    title: "Core run",
    prompt: "Do the thing",
    model: "m-1",
    status: "completed",
    events: [coreEvent()],
    metrics: { durationMs: 1000, totalTokens: 50, costUsd: 0.001 },
    checkpoints: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:40.000Z",
    ...overrides,
  }
}

describe("coreStatusToOpsStatus", () => {
  it("maps every core status", () => {
    expect(coreStatusToOpsStatus("completed")).toBe("succeeded")
    expect(coreStatusToOpsStatus("pending")).toBe("queued")
    expect(coreStatusToOpsStatus("queued")).toBe("queued")
    expect(coreStatusToOpsStatus("running")).toBe("running")
    expect(coreStatusToOpsStatus("failed")).toBe("failed")
    expect(coreStatusToOpsStatus("cancelled")).toBe("cancelled")
  })
})

describe("coreRunToOpsRecord", () => {
  it("maps a completed run end-to-end", () => {
    const ops = coreRunToOpsRecord(coreRun())
    expect(ops.id).toBe("core_run_1")
    expect(ops.name).toBe("Core run")
    expect(ops.status).toBe("succeeded")
    expect(ops.model).toBe("m-1")
    expect(ops.finishedAt).toBe("2026-01-01T00:01:40.000Z")
    expect(ops.metrics.totalTokens).toBe(50)
    expect(ops.metrics.costUsd).toBe(0.001)
    expect(ops.events).toHaveLength(1)
    expect(ops.events[0].kind).toBe("log")
    expect(ops.events[0].message).toBe("Planned")
    expect(ops.tags).toEqual([])
    expect(ops.steps).toEqual([])
  })

  it("leaves finishedAt unset for active runs", () => {
    const ops = coreRunToOpsRecord(coreRun({ status: "running" }))
    expect(ops.status).toBe("running")
    expect(ops.finishedAt).toBeUndefined()
  })

  it("maps error/approval/status event types to stream kinds", () => {
    const ops = coreRunToOpsRecord(
      coreRun({
        events: [
          coreEvent({ id: "e1", type: "error", status: "error", summary: "boom" }),
          coreEvent({ id: "e2", seq: 2, type: "approval", name: "deploy" }),
          coreEvent({ id: "e3", seq: 3, type: "status", summary: "done" }),
        ],
      }),
    )
    expect(ops.events[0].kind).toBe("error")
    expect(ops.events[0].level).toBe("error")
    expect(ops.events[1].kind).toBe("approval_required")
    expect(ops.events[2].kind).toBe("status")
  })
})
