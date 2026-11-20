import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AgentRunScheduleForm } from "./agent-run-schedule-form"
import type { ScheduleInput } from "@/lib/agent-runs/ops/schedule"

describe("AgentRunScheduleForm", () => {
  it("submits a cron schedule with the selected template", async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<AgentRunScheduleForm onSubmit={onSubmit} />)

    await user.selectOptions(screen.getByLabelText(/Repeats/), "interval")
    await user.clear(screen.getByLabelText(/Interval/))
    await user.type(screen.getByLabelText(/Interval/), "30")
    await user.click(screen.getByRole("button", { name: /Create schedule/ }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const input = onSubmit.mock.calls[0][0] as ScheduleInput
    expect(input.kind).toBe("interval")
    expect(input.intervalMs).toBe(30 * 60_000)
    expect(input.templateId).toBe("tpl.code-review")
  })

  it("requires a prompt when no template is selected", async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<AgentRunScheduleForm onSubmit={onSubmit} />)

    await user.selectOptions(screen.getByLabelText(/Template/), "")
    await user.click(screen.getByRole("button", { name: /Create schedule/ }))

    // Native `required` blocks submission before our validator runs.
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("shows the cron humanization preview", async () => {
    const user = userEvent.setup()
    render(<AgentRunScheduleForm />)

    const cronInput = screen.getByLabelText(/Cron expression/)
    await user.clear(cronInput)
    await user.type(cronInput, "0 17 * * 5")

    expect(await screen.findByText(/At 05:00 PM, every Friday/)).toBeInTheDocument()
  })

  it("calls onCancel", async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<AgentRunScheduleForm onCancel={onCancel} />)
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalled()
  })
})
