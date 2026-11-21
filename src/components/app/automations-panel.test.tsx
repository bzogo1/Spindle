import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AutomationsPanel } from "./automations-panel"

describe("AutomationsPanel", () => {
  it("loads mock automations and toggles the enabled switch", async () => {
    render(<AutomationsPanel />)

    expect(screen.getByRole("heading", { name: "Automations" })).toBeInTheDocument()
    // Automation names appear in both the analytics table and the main table.
    expect((await screen.findAllByText("Daily results digest")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("Survey file watch").length).toBeGreaterThan(0)

    const toggle = screen.getByRole("switch", { name: "Enable Daily results digest" })
    expect(toggle).toHaveAttribute("aria-checked", "true")

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-checked", "false")
  })

  it("expands run history with mock log lines and the step list", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Daily results digest")
    await userEvent.click(
      screen.getByRole("button", { name: "Show run history for Daily results digest" }),
    )

    expect(await screen.findByText(/Loaded project index \(42 files\)/)).toBeInTheDocument()
    expect(screen.getByText("Collect new results since the last run")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Hide run history for Daily results digest" }),
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("validates required fields before creating an automation", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Cron" }))
    await userEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect(await screen.findByText("Name is required.")).toBeInTheDocument()
    expect(screen.getByText("Add a prompt or instructions.")).toBeInTheDocument()
  })

  it("creates an automation from the cron mode with a live preview", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Cron" }))

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Friday digest" } })
    fireEvent.change(screen.getByLabelText("Cron expression"), {
      target: { value: "0 9 * * 5" },
    })
    fireEvent.change(screen.getByLabelText("Prompt or instructions"), {
      target: { value: "Post a weekly project digest." },
    })

    expect(screen.getByText("At 09:00 AM, every Friday")).toBeInTheDocument()
    expect(screen.getByText("Next runs")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect((await screen.findAllByText("Friday digest")).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("generates a draft from a natural-language request in Ask AI mode", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    expect(await screen.findByRole("tab", { name: "Ask AI" })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    fireEvent.change(screen.getByLabelText("Describe the automation"), {
      target: { value: "Every Monday at 8am summarize new papers and email me a digest" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Generate draft" }))

    expect((await screen.findAllByText("Weekly paper summary")).length).toBeGreaterThan(0)
    expect(screen.getByText(/At 08:00 AM, every Monday/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect((await screen.findAllByText("Weekly paper summary")).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("builds an event-driven automation with ordered action steps", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Builder" }))

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Upload watcher" } })
    fireEvent.change(screen.getByLabelText("Prompt or instructions"), {
      target: { value: "React to uploads." },
    })

    fireEvent.change(screen.getByLabelText("Trigger"), { target: { value: "event" } })
    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "file.uploaded" },
    })

    // Default builder state already has one action step; add a second and reorder.
    fireEvent.change(screen.getByLabelText("Add action step"), {
      target: { value: "post-summary" },
    })

    const stepsList = screen.getByRole("list")
    expect(within(stepsList).getAllByRole("listitem")).toHaveLength(2)

    await userEvent.click(screen.getByRole("button", { name: "Move Post run summary up" }))
    const reordered = screen.getByRole("list")
    expect(within(reordered).getAllByRole("listitem")[0]).toHaveTextContent("Post run summary")

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect((await screen.findAllByText("Upload watcher")).length).toBeGreaterThan(0)
  })

  it("creates an automation from the graph builder tab", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Graph" }))

    // The seeded starter graph renders the node palette and canvas.
    expect(await screen.findByText("Node palette")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Node Schedule trigger/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Graph digest" } })
    fireEvent.change(screen.getByLabelText("Prompt or instructions"), {
      target: { value: "Run the graph." },
    })

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect((await screen.findAllByText("Graph digest")).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    // Saved via the graph mode, so the row is tagged accordingly.
    expect(screen.getByText(/· Graph/)).toBeInTheDocument()
  })

  it("requires a name in graph mode before saving", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Graph" }))
    await screen.findByText("Node palette")

    fireEvent.change(screen.getByLabelText("Prompt or instructions"), {
      target: { value: "Run the graph." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect(await screen.findByText("Give the automation a name.")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("deletes an automation after confirmation", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Weekly agent review")
    await userEvent.click(screen.getByRole("button", { name: "Delete Weekly agent review" }))

    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete automation" }))

    await waitFor(() => expect(screen.queryByText("Weekly agent review")).not.toBeInTheDocument())
  })

  it("edits an automation from the studio dialog", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Weekly agent review")
    await userEvent.click(screen.getByRole("button", { name: "Edit Weekly agent review" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Weekly agent review")
    expect(within(dialog).getByLabelText("Cron expression")).toHaveValue("0 17 * * 5")

    fireEvent.change(within(dialog).getByLabelText("Cron expression"), {
      target: { value: "0 18 * * 5" },
    })
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(await screen.findByText(/At 06:00 PM, every Friday/)).toBeInTheDocument()
  })

  it("creates an interval-scheduled automation from the cron tab", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Cron" }))

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pulse check" } })
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "interval" } })
    fireEvent.change(screen.getByLabelText("Repeat every"), { target: { value: "15" } })
    fireEvent.change(screen.getByLabelText("Interval unit"), { target: { value: "minutes" } })
    fireEvent.change(screen.getByLabelText("Prompt or instructions"), {
      target: { value: "Check system vitals." },
    })

    expect(screen.getByText("Every 15 minutes")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    expect((await screen.findAllByText("Pulse check")).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    // The saved row shows the interval description and a computed next run.
    expect(screen.getAllByText("Every 15 minutes").length).toBeGreaterThan(0)
  })

  it("rejects an invalid interval before saving", async () => {
    render(<AutomationsPanel />)

    await userEvent.click(await screen.findByRole("button", { name: "New automation" }))
    await userEvent.click(await screen.findByRole("tab", { name: "Cron" }))

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad interval" } })
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "interval" } })
    fireEvent.change(screen.getByLabelText("Repeat every"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("Prompt or instructions"), {
      target: { value: "Should not save." },
    })

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    // The interval hint and the saved error state can both render the message.
    expect((await screen.findAllByText(/at least 1/)).length).toBeGreaterThan(0)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("opens a sandboxed test dialog wired to the dry-run panel", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Daily results digest")

    await userEvent.click(
      screen.getByRole("button", { name: "Test Daily results digest in sandbox" }),
    )

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Sandboxed preview/)).toBeInTheDocument()
    // The embedded builder exposes the dry-run panel for simulated execution.
    expect(
      await within(dialog).findByRole("button", { name: /Run dry run/ }),
    ).toBeInTheDocument()
  })

  it("runs an automation manually with a live run preview", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Daily results digest")
    await userEvent.click(screen.getByRole("button", { name: "Run Daily results digest now" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Run preview/)).toBeInTheDocument()

    // Cancelling mid-run records a cancelled entry in the run history.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel run" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await userEvent.click(
      screen.getByRole("button", { name: "Show run history for Daily results digest" }),
    )

    expect(await screen.findByText("Manual run")).toBeInTheDocument()
    expect(screen.getAllByText("cancelled").length).toBeGreaterThan(0)
  })

  it("shows per-automation run analytics", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Daily results digest")

    expect(screen.getByRole("heading", { name: "Run analytics" })).toBeInTheDocument()
    // Workspace rollup: 4 runs, 3 succeeded, avg (24+19+8+41)/4 = 23s.
    expect(screen.getByText("75%")).toBeInTheDocument()
    expect(screen.getByText("23s")).toBeInTheDocument()

    const analyticsTable = screen
      .getByRole("table", { name: "Per-automation run statistics" })
      .closest(".app-table-wrap")
    expect(analyticsTable).not.toBeNull()

    // Daily results digest: 2 runs, both succeeded, avg 21.5s.
    const digestRow = within(analyticsTable as HTMLElement)
      .getByText("Daily results digest")
      .closest("tr")
    expect(digestRow).not.toBeNull()
    expect(within(digestRow as HTMLElement).getByText("2")).toBeInTheDocument()
    expect(within(digestRow as HTMLElement).getByText("100%")).toBeInTheDocument()
    expect(within(digestRow as HTMLElement).getByText("21.5s")).toBeInTheDocument()

    // Survey file watch: its only run failed.
    const surveyRow = within(analyticsTable as HTMLElement)
      .getByText("Survey file watch")
      .closest("tr")
    expect(within(surveyRow as HTMLElement).getByText("0%")).toBeInTheDocument()
  })

  it("shows Paused in the next-run column for disabled automations", async () => {
    render(<AutomationsPanel />)

    await screen.findAllByText("Weekly agent review")

    expect(screen.getByText("Paused")).toBeInTheDocument()
  })
})
