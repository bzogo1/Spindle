import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AgentRunSchedulePanel } from "./agent-run-schedule-panel"
import {
  clearScheduleStore,
  getAgentRunSchedule,
  listAgentRunSchedules,
  saveNewAgentRunSchedule,
} from "@/lib/agent-runs/ops/schedule"

function seedSchedule(name = "Nightly review") {
  const result = saveNewAgentRunSchedule({
    name,
    kind: "cron",
    templateId: "tpl.code-review",
    cron: "0 9 * * 1-5",
  })
  if (!result.schedule) throw new Error("seed failed")
  return result.schedule
}

describe("AgentRunSchedulePanel", () => {
  beforeEach(() => {
    clearScheduleStore()
    window.localStorage.clear()
  })

  it("shows the empty state", () => {
    render(<AgentRunSchedulePanel />)
    expect(screen.getByText(/No schedules yet/)).toBeInTheDocument()
  })

  it("lists schedules with status and next run", () => {
    seedSchedule()
    render(<AgentRunSchedulePanel />)
    expect(screen.getByText("Nightly review")).toBeInTheDocument()
    expect(screen.getByText("active")).toBeInTheDocument()
    expect(screen.getByText(/At 09:00 AM/)).toBeInTheDocument()
  })

  it("creates a schedule through the form", async () => {
    const user = userEvent.setup()
    render(<AgentRunSchedulePanel />)

    await user.click(screen.getByRole("button", { name: /New schedule/ }))
    await user.type(screen.getByLabelText(/Name/), "Morning digest")
    await user.click(screen.getByRole("button", { name: /Create schedule/ }))

    expect(await screen.findByText("Morning digest")).toBeInTheDocument()
    expect(listAgentRunSchedules()).toHaveLength(1)
    expect(screen.getByText(/Schedule "Morning digest" created/)).toBeInTheDocument()
  })

  it("shows validation errors for a bad cron", async () => {
    const user = userEvent.setup()
    render(<AgentRunSchedulePanel />)

    await user.click(screen.getByRole("button", { name: /New schedule/ }))
    const cronInput = screen.getByLabelText(/Cron expression/)
    await user.clear(cronInput)
    await user.type(cronInput, "bogus")
    await user.click(screen.getByRole("button", { name: /Create schedule/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/cron expression is invalid/i)
    expect(listAgentRunSchedules()).toHaveLength(0)
  })

  it("runs a schedule now and reports the queued run", async () => {
    const schedule = seedSchedule()
    const onRunCreated = vi.fn()
    render(<AgentRunSchedulePanel onRunCreated={onRunCreated} />)

    await userEvent.click(screen.getByRole("button", { name: /Run now/ }))

    const updated = getAgentRunSchedule(schedule.id)!
    expect(updated.runCount).toBe(1)
    expect(updated.lastRunId).toBeTruthy()
    expect(onRunCreated).toHaveBeenCalledWith(updated.lastRunId, expect.anything())
    expect(screen.getByText(/Queued run/)).toBeInTheDocument()
  })

  it("pauses, resumes, and cancels a schedule", async () => {
    const schedule = seedSchedule()
    const user = userEvent.setup()
    render(<AgentRunSchedulePanel />)

    await user.click(screen.getByRole("button", { name: "Pause" }))
    expect(getAgentRunSchedule(schedule.id)!.status).toBe("paused")

    await user.click(screen.getByRole("button", { name: "Resume" }))
    expect(getAgentRunSchedule(schedule.id)!.status).toBe("active")

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    const cancelled = getAgentRunSchedule(schedule.id)!
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.nextRunAt).toBeUndefined()
    // Terminal schedules disable run-now and lose pause/cancel actions.
    expect(screen.getByRole("button", { name: "Run now" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Delete schedule/ })).toBeInTheDocument()
  })

  it("deletes a schedule", async () => {
    const schedule = seedSchedule()
    render(<AgentRunSchedulePanel />)

    await userEvent.click(screen.getByRole("button", { name: /Delete schedule/ }))
    expect(getAgentRunSchedule(schedule.id)).toBeNull()
    expect(screen.getByText(/No schedules yet/)).toBeInTheDocument()
  })

  it("fires due schedules and keeps the rest", async () => {
    const due = saveNewAgentRunSchedule({
      name: "Due one",
      kind: "interval",
      prompt: "ping",
      intervalMs: 60_000,
    })
    // Force it due by backdating nextRunAt.
    const forced = { ...due.schedule!, nextRunAt: new Date(Date.now() - 1000).toISOString() }
    const { updateAgentRunSchedule } = await import("@/lib/agent-runs/ops/schedule")
    updateAgentRunSchedule(forced)
    seedSchedule("Future cron")

    render(<AgentRunSchedulePanel />)
    await userEvent.click(screen.getByRole("button", { name: /Fire due/ }))

    expect(screen.getByText(/Fired 1 due schedule/)).toBeInTheDocument()
    expect(getAgentRunSchedule(forced.id)!.runCount).toBe(1)
    expect(within(screen.getByRole("table")).getAllByRole("row").length).toBe(3) // head + 2 rows
  })
})
