import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { GraphIssue } from "@/lib/automation-graph"

import { ValidationPanel } from "./validation-panel"

const issues: GraphIssue[] = [
  {
    severity: "error",
    code: "self-loop",
    message: "A node cannot connect to itself.",
    nodeId: "n1",
  },
  {
    severity: "warning",
    code: "unreachable-node",
    message: 'Node "Transform" is not reachable from any trigger.',
    nodeId: "n2",
  },
]

describe("ValidationPanel", () => {
  it("shows a valid state when there are no issues", () => {
    render(<ValidationPanel issues={[]} />)
    expect(screen.getByText("Valid")).toBeInTheDocument()
    expect(screen.getByText("No issues found.")).toBeInTheDocument()
  })

  it("lists error and warning messages with counts", () => {
    render(<ValidationPanel issues={issues} />)
    expect(screen.getByText("1 error")).toBeInTheDocument()
    expect(screen.getByText("A node cannot connect to itself.")).toBeInTheDocument()
    expect(
      screen.getByText('Node "Transform" is not reachable from any trigger.'),
    ).toBeInTheDocument()
  })

  it("pluralizes counts and prioritizes errors over warnings", () => {
    render(
      <ValidationPanel
        issues={[
          ...issues,
          { severity: "error", code: "cycle", message: "Graph contains a cycle." },
          { severity: "warning", code: "missing-trigger", message: "No trigger node." },
        ]}
      />,
    )
    expect(screen.getByText("2 errors")).toBeInTheDocument()
    expect(screen.queryByText(/warnings?/)).not.toBeInTheDocument()
  })

  it("shows warnings only when there are no errors", () => {
    render(
      <ValidationPanel
        issues={[{ severity: "warning", code: "missing-trigger", message: "No trigger." }]}
      />,
    )
    expect(screen.getByText("1 warning")).toBeInTheDocument()
  })

  it("reports the clicked issue via onSelectIssue", async () => {
    const user = userEvent.setup()
    const onSelectIssue = vi.fn()
    render(<ValidationPanel issues={issues} onSelectIssue={onSelectIssue} />)

    await user.click(screen.getByRole("button", { name: "A node cannot connect to itself." }))
    expect(onSelectIssue).toHaveBeenCalledWith(issues[0])
  })

  it("renders plain text rows when no selection handler is provided", () => {
    render(<ValidationPanel issues={issues} />)
    expect(
      screen.queryByRole("button", { name: "A node cannot connect to itself." }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("A node cannot connect to itself.")).toBeInTheDocument()
  })
})
