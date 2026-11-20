import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph } from "@/lib/automation-graph"

import { TestRunnerPanel } from "./test-runner-panel"

function graph() {
  let g = createEmptyGraph("Testable")
  g = addNodeToGraph(g, "trigger.schedule", { x: 0, y: 0 })
  g = addNodeToGraph(g, "action.post-summary", { x: 200, y: 0 })
  g = addEdgeToGraph(g, {
    sourceNodeId: g.nodes[0].id,
    sourcePort: "out",
    targetNodeId: g.nodes[1].id,
    targetPort: "in",
  })
  return g
}

beforeEach(() => window.localStorage.clear())

describe("TestRunnerPanel", () => {
  it("runs sample cases and shows pass/fail + coverage", async () => {
    const user = userEvent.setup()
    render(<TestRunnerPanel graph={graph()} scope="tr-1" />)

    await user.click(screen.getByRole("button", { name: "Sample" }))
    await user.click(screen.getByRole("button", { name: "Run tests" }))

    expect(await screen.findByText("1/1 passed")).toBeInTheDocument()
    expect(screen.getByText("100% node coverage")).toBeInTheDocument()
    expect(screen.getByText("pass")).toBeInTheDocument()
  })

  it("shows failures for unmet expectations", async () => {
    const user = userEvent.setup()
    render(<TestRunnerPanel graph={graph()} scope="tr-2" />)

    await user.click(screen.getByRole("button", { name: "Sample" }))
    const textarea = screen.getByLabelText("Test cases JSON")
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify([{ id: "c1", name: "Expect error", expect: { status: "error" } }]),
      },
    })
    await user.click(screen.getByRole("button", { name: "Run tests" }))

    expect(await screen.findByText("0/1 passed")).toBeInTheDocument()
    expect(screen.getByText("fail")).toBeInTheDocument()
    expect(screen.getByText(/Expected overall status/)).toBeInTheDocument()
  })

  it("reports JSON parse errors", async () => {
    const user = userEvent.setup()
    render(<TestRunnerPanel graph={graph()} scope="tr-3" />)
    const textarea = screen.getByLabelText("Test cases JSON")
    fireEvent.change(textarea, { target: { value: "{bad json" } })
    await user.click(screen.getByRole("button", { name: "Run tests" }))
    expect(
      await screen.findByText(/Unexpected token|Expected property|Invalid/),
    ).toBeInTheDocument()
  })
})

describe("TestRunnerPanel scope sync", () => {
  it("reloads cases when the scope changes", async () => {
    const { writeTestCases, createTestCase } = await import("@/lib/automation-graph")
    writeTestCases("scope-a", [createTestCase("Case A")])
    writeTestCases("scope-b", [createTestCase("Case B")])

    const { rerender } = render(<TestRunnerPanel graph={graph()} scope="scope-a" />)
    const textarea = screen.getByLabelText("Test cases JSON") as HTMLTextAreaElement
    expect(textarea.value).toContain("Case A")

    rerender(<TestRunnerPanel graph={graph()} scope="scope-b" />)
    expect(textarea.value).toContain("Case B")
  })
})
