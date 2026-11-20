import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AssistPanel } from "./assist-panel"

describe("AssistPanel", () => {
  it("suggests a graph and applies it to the canvas", async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<AssistPanel onApply={onApply} />)

    const suggest = screen.getByRole("button", { name: "Suggest graph" })
    expect(suggest).toBeDisabled()

    await user.type(
      screen.getByLabelText("Describe your automation"),
      "Every Monday at 8am summarize new papers",
    )
    await user.click(suggest)

    // Preview lists the suggested nodes and notes.
    expect(await screen.findByText("AI assist")).toBeInTheDocument()
    expect(screen.getByText(/Schedule trigger|Schedule/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Apply to canvas" })).toBeInTheDocument()
    // Warns that applying replaces the canvas.
    expect(screen.getByText("Applying replaces the current canvas.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Apply to canvas" }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const graph = onApply.mock.calls[0][0]
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  it("shows guidance when empty", () => {
    render(<AssistPanel onApply={vi.fn()} />)
    expect(screen.getByText(/Describe what the automation should do/)).toBeInTheDocument()
  })
})
