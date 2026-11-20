import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { AgentRunAuditPanel } from "./agent-run-audit-panel"
import {
  appendAuditEvent,
  clearAuditLog,
  createAuditLog,
  saveAuditLog,
} from "@/lib/agent-runs/ops/audit"

describe("AgentRunAuditPanel", () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it("shows empty state", () => {
    render(<AgentRunAuditPanel />)
    expect(screen.getByText(/No audit entries yet/)).toBeInTheDocument()
  })

  it("lists entries and verifies the chain", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1", actor: "tester" })
    await appendAuditEvent(log, { type: "run.shared", runId: "r1" })
    saveAuditLog(log)

    render(<AgentRunAuditPanel runId="r1" />)
    expect(await screen.findByText("run.created")).toBeInTheDocument()
    expect(screen.getByText("run.shared")).toBeInTheDocument()
    expect(screen.getByText("tester")).toBeInTheDocument()
    // Auto-verify on mount should eventually show intact.
    expect(await screen.findByText(/chain intact/)).toBeInTheDocument()
  })

  it("filters entries by runId", async () => {
    const log = createAuditLog()
    await appendAuditEvent(log, { type: "run.created", runId: "r1" })
    await appendAuditEvent(log, { type: "run.created", runId: "r2" })
    saveAuditLog(log)
    render(<AgentRunAuditPanel runId="r2" />)
    expect(await screen.findByText(/1 entry/)).toBeInTheDocument()
    expect(screen.getAllByText("r2").length).toBeGreaterThan(0)
  })
})
