import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AgentRunCompliancePanel } from "./agent-run-compliance-panel"
import { buildOpsRun } from "@/lib/agent-runs/ops/fixtures"

describe("AgentRunCompliancePanel", () => {
  it("evaluates the standard policy by default", () => {
    render(<AgentRunCompliancePanel run={buildOpsRun()} />)
    expect(screen.getByText("compliant")).toBeInTheDocument()
    expect(screen.getByText("Required field “prompt”")).toBeInTheDocument()
  })

  it("switches policy and shows failures", async () => {
    const user = userEvent.setup()
    const run = buildOpsRun({
      actor: undefined,
      tags: [],
      retentionDays: undefined,
      summary: undefined,
    })
    render(<AgentRunCompliancePanel run={run} />)
    await user.selectOptions(screen.getByRole("combobox"), "policy.strict")
    expect(await screen.findByText("non-compliant")).toBeInTheDocument()
    expect(screen.getByText("Required tag “reviewed”")).toBeInTheDocument()
    expect(screen.getByText("Retention window declared")).toBeInTheDocument()
  })
})
