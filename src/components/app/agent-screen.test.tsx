import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { AgentScreen } from "./agent-screen"

/** The mock store advances one step per 700ms tick; four steps ≈ 2.8s. */
const RUN_TIMEOUT = 4500

async function startRun(prompt = "Summarize the latest field notes") {
  render(<AgentScreen projectId="prj_agent_screen" />)

  // Wait for the workspace snapshot, then fill the composer. The composer
  // section shares the "Agent prompt" aria-label, so query by placeholder.
  const textarea = await screen.findByPlaceholderText(/Describe the change/)
  await userEvent.type(textarea, prompt)
  await userEvent.click(screen.getByRole("button", { name: /Run agent/ }))
}

describe("AgentScreen", () => {
  it("shows the run configuration pickers alongside the quota", async () => {
    render(<AgentScreen projectId="prj_agent_config" />)

    expect(await screen.findByLabelText("Model")).toHaveValue("spindle-1")
    expect(screen.getByLabelText("Run scope")).toHaveValue("project")
    expect(screen.getByText(/requests left/)).toBeInTheDocument()
  })

  it("persists a model selection and records it on the started run", async () => {
    render(<AgentScreen projectId="prj_agent_model" />)

    const modelSelect = await screen.findByLabelText("Model")
    await userEvent.selectOptions(modelSelect, "spindle-1-pro")
    expect(modelSelect).toHaveValue("spindle-1-pro")

    const textarea = screen.getByPlaceholderText(/Describe the change/)
    await userEvent.type(textarea, "Regenerate the model card")
    await userEvent.click(screen.getByRole("button", { name: /Run agent/ }))

    // The run header carries the config snapshot once the run appears.
    expect(
      await screen.findByText(/Spindle 1 Pro · Whole project/, undefined, {
        timeout: RUN_TIMEOUT,
      }),
    ).toBeInTheDocument()
  })

  it("previews run steps and gates the diff behind approval", async () => {
    await startRun("Add a review_status column to the tidal export")

    // Steps stream in as the mock run advances.
    expect(
      await screen.findByText("Plan the requested project changes", undefined, {
        timeout: RUN_TIMEOUT,
      }),
    ).toBeInTheDocument()

    // Once every step finishes the run waits for diff review.
    const approve = await screen.findByRole(
      "button",
      { name: "Approve diff" },
      { timeout: RUN_TIMEOUT },
    )
    await userEvent.click(approve)

    await waitFor(
      () => {
        expect(screen.getByText(/Review state:/)).toHaveTextContent("approved")
      },
      { timeout: RUN_TIMEOUT },
    )
    expect(screen.queryByRole("button", { name: "Approve diff" })).not.toBeInTheDocument()
  })

  it("rejects a proposed diff without writing files", async () => {
    await startRun("Find notebooks that read survey.parquet")

    const reject = await screen.findByRole(
      "button",
      { name: "Reject diff" },
      { timeout: RUN_TIMEOUT },
    )
    await userEvent.click(reject)

    await waitFor(
      () => {
        expect(screen.getByText(/Review state:/)).toHaveTextContent("rejected")
      },
      { timeout: RUN_TIMEOUT },
    )
    expect(screen.getByText("Diff rejected. No project files were changed.")).toBeInTheDocument()
  })
})
