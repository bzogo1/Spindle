import { useState } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  createEmptyGraph,
  addNodeToGraph,
  addEdgeToGraph,
  readGraphVersions,
  graphHistoryStorageKey,
} from "@/lib/automation-graph"

import { AutomationBuilder } from "./automation-builder"

describe("AutomationBuilder", () => {
  it("renders an empty canvas with the node palette", () => {
    render(<AutomationBuilder />)
    expect(screen.getByText("Empty canvas")).toBeInTheDocument()
    expect(screen.getByText("Node palette")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add Schedule trigger node" })).toBeInTheDocument()
  })

  it("adds nodes from the palette and connects them via the connections panel", async () => {
    const user = userEvent.setup()
    render(<AutomationBuilder />)

    await user.click(screen.getByRole("button", { name: "Add Schedule trigger node" }))
    await user.click(screen.getByRole("button", { name: "Add Transform node" }))

    expect(screen.getByRole("button", { name: /Node Schedule trigger/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Node Transform/ })).toBeInTheDocument()

    // Keyboard-accessible connection: trigger.out -> transform.in
    await user.selectOptions(screen.getByLabelText("From node"), "Schedule trigger")
    await user.selectOptions(screen.getByLabelText("Output port"), "out")
    await user.selectOptions(screen.getByLabelText("To node"), "Transform")
    await user.selectOptions(screen.getByLabelText("Input port"), "in")
    await user.click(screen.getByRole("button", { name: "Connect nodes" }))

    expect(await screen.findByText("Connection added.")).toBeInTheDocument()
    expect(screen.getByText(/1 node · 1 connection|2 nodes · 1 connection/)).toBeInTheDocument()
  })

  it("runs a dry run and shows per-node results", async () => {
    const user = userEvent.setup()
    let graph = createEmptyGraph("Smoke")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 300, y: 0 })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })

    render(<AutomationBuilder defaultGraph={graph} />)

    await user.click(screen.getByRole("button", { name: "Run dry run" }))

    await waitFor(() => {
      expect(screen.getAllByText("success").length).toBeGreaterThanOrEqual(2)
    })
    expect(screen.getByText(/2 succeeded/)).toBeInTheDocument()
  })

  it("loads a starter template onto the canvas", async () => {
    const user = userEvent.setup()
    render(<AutomationBuilder />)

    await user.click(screen.getByRole("button", { name: "Templates" }))
    await user.click(screen.getByRole("menuitem", { name: /Daily digest/ }))

    expect(screen.getByRole("button", { name: /Node Schedule trigger/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Node Agent task/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Node Post run summary/ })).toBeInTheDocument()
    expect(screen.getByText(/3 nodes · 2 connections/)).toBeInTheDocument()
  })

  it("shows validation errors for cyclic graphs", () => {
    let graph = createEmptyGraph("Bad")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 300, y: 0 })
    // Force a self-loop past canConnect.
    graph.edges.push({
      id: "e_bad",
      sourceNodeId: graph.nodes[1].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })

    render(<AutomationBuilder defaultGraph={graph} />)

    expect(screen.getByText(/cannot connect to itself/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run dry run" })).toBeDisabled()
  })

  it("surfaces missing required config in the validation panel", async () => {
    const user = userEvent.setup()
    render(<AutomationBuilder />)

    // Agent task ships with an empty required prompt.
    await user.click(screen.getByRole("button", { name: "Add Agent task node" }))

    expect(await screen.findByText(/missing required configuration "Prompt"/)).toBeInTheDocument()
    expect(screen.getByText(/1 error/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run dry run" })).toBeDisabled()
  })

  it("selects the node referenced by a validation issue when clicked", async () => {
    const user = userEvent.setup()
    let graph = createEmptyGraph("Bad")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "agent.task", { x: 300, y: 0 })

    render(<AutomationBuilder defaultGraph={graph} />)

    // The agent task has an empty required prompt → error issue with nodeId.
    await user.click(await screen.findByRole("button", { name: /missing required configuration/ }))

    // Selecting the issue opens the inspector for that node.
    expect(await screen.findByLabelText("Label")).toHaveValue("Agent task")
  })

  it("adds a comment on the selected node and badges it on the canvas", async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    let graph = createEmptyGraph("Collab")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })

    render(<AutomationBuilder defaultGraph={graph} historyScope="test-collab" />)

    // Presence strip shows the local user plus simulated collaborators.
    expect(screen.getByText(/collaborators/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Node Schedule trigger/ }))
    await user.type(screen.getByLabelText("New comment"), "Needs a retry policy")
    await user.click(screen.getByRole("button", { name: "Add comment" }))

    expect(await screen.findByText("Needs a retry policy")).toBeInTheDocument()
    expect(screen.getByLabelText("1 comment")).toBeInTheDocument()
  })

  it("snapshots edits into version history and restores a previous version", async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    render(<AutomationBuilder historyScope="test-builder" />)

    // Auto-snapshot fires after the edit debounce settles.
    await user.click(screen.getByRole("button", { name: "Add Schedule trigger node" }))
    await waitFor(
      () => {
        expect(readGraphVersions("test-builder")).toHaveLength(1)
      },
      { timeout: 3000 },
    )

    // A named snapshot pins the current state.
    await user.type(screen.getByLabelText("Version label"), "with trigger")
    await user.click(screen.getByRole("button", { name: "Snapshot" }))
    await waitFor(() => {
      expect(readGraphVersions("test-builder")[0].label).toBe("with trigger")
    })

    // Add another node, then restore the labeled snapshot (there are several
    // restore buttons once auto-snapshots accumulate).
    await user.click(screen.getByRole("button", { name: "Add Transform node" }))
    const labeledItem = screen.getByText("with trigger").closest("li")
    expect(labeledItem).not.toBeNull()
    await user.click(
      within(labeledItem as HTMLElement).getByRole("button", {
        name: "Restore this version",
      }),
    )

    await waitFor(() => {
      const versions = readGraphVersions("test-builder")
      const restored = versions.find((v) => v.label === "with trigger")
      expect(restored?.graph.nodes).toHaveLength(1)
    })
    expect(screen.queryByRole("button", { name: /Node Transform/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Node Schedule trigger/ })).toBeInTheDocument()
    expect(window.localStorage.getItem(graphHistoryStorageKey("test-builder"))).toBeTruthy()
  })

  it("does not append a duplicate version when a restore keeps a regenerated graph id", async () => {
    const user = userEvent.setup()
    window.localStorage.clear()

    // Controlled harness: the parent regenerates `graph.id` while keeping a
    // stable historyScope (e.g. the studio dialog rebuilds starter graphs).
    function Harness() {
      const [graph, setGraph] = useState(() => {
        const empty = createEmptyGraph("Dedupe")
        return addNodeToGraph(empty, "trigger.schedule", { x: 0, y: 0 })
      })
      return (
        <>
          <button
            type="button"
            onClick={() => setGraph((current) => ({ ...current, id: `g_${Math.random()}` }))}
          >
            Regenerate graph id
          </button>
          <AutomationBuilder
            graph={graph}
            onGraphChange={setGraph}
            historyScope="test-restore-dedupe"
          />
        </>
      )
    }
    render(<Harness />)

    // Record a snapshot, then regenerate the graph id (same content).
    await user.click(screen.getByRole("button", { name: "Add Transform node" }))
    await waitFor(
      () => {
        expect(readGraphVersions("test-restore-dedupe")).toHaveLength(1)
      },
      { timeout: 3000 },
    )
    await user.click(screen.getByRole("button", { name: "Regenerate graph id" }))

    // Restoring commits the stored graph under the *current* id; once the
    // edit debounce settles the auto-snapshot must dedupe against the stored
    // version instead of appending a near-duplicate that burns a cap slot.
    await user.click(screen.getByRole("button", { name: "Restore this version" }))
    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(readGraphVersions("test-restore-dedupe")).toHaveLength(1)
  })
})
