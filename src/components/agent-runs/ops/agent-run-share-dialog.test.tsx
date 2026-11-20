import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AgentRunShareDialog } from "./agent-run-share-dialog"
import { buildOpsRun } from "@/lib/agent-runs/ops/fixtures"
import { createAgentRunSharePayload, encodeAgentRunShare } from "@/lib/agent-runs/ops/share"

describe("AgentRunShareDialog", () => {
  it("opens and shows share URL + import section", async () => {
    const user = userEvent.setup()
    render(<AgentRunShareDialog run={buildOpsRun()} />)
    await user.click(screen.getByRole("button", { name: /share run/i }))
    expect(await screen.findByText(/Share agent run/)).toBeInTheDocument()
    expect(screen.getByText("Copy share URL")).toBeInTheDocument()
    expect(screen.getByText("Copy JSON")).toBeInTheDocument()
    expect(screen.getByLabelText("Share payload to import")).toBeInTheDocument()
  })

  it("imports a pasted JSON share payload", async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    const run = buildOpsRun({ id: "run_shared_1" })
    const payload = createAgentRunSharePayload({ run })
    render(<AgentRunShareDialog run={buildOpsRun()} onImport={onImport} />)
    await user.click(screen.getByRole("button", { name: /share run/i }))
    const textarea = await screen.findByLabelText("Share payload to import")
    await user.click(textarea)
    await user.paste(encodeAgentRunShare(payload))
    await user.click(screen.getByRole("button", { name: /import run/i }))
    expect(onImport).toHaveBeenCalledTimes(1)
    const imported = onImport.mock.calls[0][0]
    expect(imported.tags).toContain("shared:run_shared_1")
    expect(imported.id).not.toBe("run_shared_1")
    expect(await screen.findByText(/Imported as run/)).toBeInTheDocument()
  })

  it("shows an error for undecodable input", async () => {
    const user = userEvent.setup()
    render(<AgentRunShareDialog run={buildOpsRun()} />)
    await user.click(screen.getByRole("button", { name: /share run/i }))
    const textarea = await screen.findByLabelText("Share payload to import")
    await user.click(textarea)
    await user.paste("definitely not a payload")
    await user.click(screen.getByRole("button", { name: /import run/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not decode/)
  })
})
