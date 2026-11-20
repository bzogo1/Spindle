import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AgentRunSecurityPanel } from "./agent-run-security-panel"
import { buildOpsEvent, buildOpsRun } from "@/lib/agent-runs/ops/fixtures"

const KEY = "sk-abcdefghijklmnopqrstuvwxyz123456"

describe("AgentRunSecurityPanel", () => {
  it("reports a clean run", () => {
    render(<AgentRunSecurityPanel run={buildOpsRun()} />)
    // Empty-state copy and the clean recommendation both mention "no secrets".
    expect(screen.getAllByText(/No secrets or PII/).length).toBeGreaterThan(0)
    expect(screen.getByText("clean")).toBeInTheDocument()
  })

  it("surfaces findings for a leaky run", () => {
    const run = buildOpsRun({
      events: [buildOpsEvent({ id: "e1", message: `leaked ${KEY}` })],
    })
    render(<AgentRunSecurityPanel run={run} />)
    expect(screen.getByText("API key / access token")).toBeInTheDocument()
    // "high" appears on both the risk badge and the finding severity badge.
    expect(screen.getAllByText("high").length).toBeGreaterThan(0)
    // Sample must be redacted.
    expect(screen.queryByText(new RegExp(KEY.slice(0, 12)))).not.toBeInTheDocument()
    expect(screen.getByText(/Rotate any exposed credentials/)).toBeInTheDocument()
  })

  it("offers redacted copy for dirty runs", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    const run = buildOpsRun({
      events: [buildOpsEvent({ id: "e1", message: `mail bob@example.com key ${KEY}` })],
    })
    render(<AgentRunSecurityPanel run={run} />)
    await user.click(screen.getByRole("button", { name: /copy redacted run/i }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(writeText.mock.calls[0][0] as string)
    expect(payload.prompt).not.toContain(KEY)
    expect(JSON.stringify(payload.events)).not.toContain(KEY)
    expect(JSON.stringify(payload.events)).not.toContain("bob@example.com")
    expect(await screen.findByText("Copied!")).toBeInTheDocument()
  })
})
