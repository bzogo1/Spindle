import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AgentRunBackupPanel } from "./agent-run-backup-panel"
import { buildOpsRun } from "@/lib/agent-runs/ops/fixtures"
import { clearRunsAutoBackup, loadRunsAutoBackup } from "@/lib/agent-runs/ops/backup"

describe("AgentRunBackupPanel", () => {
  beforeEach(() => {
    clearRunsAutoBackup()
  })

  it("renders manifest info and actions", () => {
    render(<AgentRunBackupPanel runs={[buildOpsRun({ id: "b1" })]} />)
    expect(screen.getByText(/1 run in scope/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /download json backup/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save auto-backup/i })).toBeInTheDocument()
    expect(screen.getByText(/No auto-backup snapshot/)).toBeInTheDocument()
  })

  it("saves and restores the auto-backup", async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    const runs = [buildOpsRun({ id: "auto1" }), buildOpsRun({ id: "auto2" })]
    render(<AgentRunBackupPanel runs={runs} onImport={onImport} />)

    await user.click(screen.getByRole("button", { name: /save auto-backup/i }))
    expect(loadRunsAutoBackup()?.runs).toHaveLength(2)
    expect(await screen.findByText(/Auto-backup: 2 run/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /restore auto-backup/i }))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onImport.mock.calls[0][0].map((r: { id: string }) => r.id)).toEqual(["auto1", "auto2"])
    expect(onImport.mock.calls[0][1]).toBe("autobackup")
    expect(await screen.findByText(/Restored 2 run/)).toBeInTheDocument()
  })

  it("reports when no auto-backup exists", async () => {
    const user = userEvent.setup()
    render(<AgentRunBackupPanel runs={[]} />)
    await user.click(screen.getByRole("button", { name: /restore auto-backup/i }))
    expect(await screen.findByText(/No auto-backup found/)).toBeInTheDocument()
  })
})
