import { describe, expect, it } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph, updateNode } from "./graph"
import { describeDiff, diffGraphs, summarizeDiff } from "./diff"
import type { AutomationGraph } from "./types"

function baseGraph(): AutomationGraph {
  let graph = createEmptyGraph("Diff me")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[0].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[1].id,
    targetPort: "in",
  })
  return graph
}

describe("diffGraphs", () => {
  it("reports identical graphs as unchanged", () => {
    const graph = baseGraph()
    const diff = diffGraphs(graph, { ...graph, nodes: [...graph.nodes], edges: [...graph.edges] })
    expect(diff.unchanged).toBe(true)
    expect(describeDiff(diff)).toBe("No changes")
  })

  it("detects added and removed nodes", () => {
    const before = baseGraph()
    const after = addNodeToGraph(before, "action.log", { x: 400, y: 0 })
    const diff = diffGraphs(before, after)
    expect(diff.addedNodes).toHaveLength(1)
    expect(diff.addedNodes[0].type).toBe("action.log")
    expect(diff.removedNodes).toHaveLength(0)
    expect(diff.unchanged).toBe(false)
  })

  it("detects removed nodes and their edges", () => {
    const before = baseGraph()
    const after = {
      ...before,
      nodes: before.nodes.filter((n) => n.type !== "transform"),
      edges: [],
    }
    const diff = diffGraphs(before, after)
    expect(diff.removedNodes).toHaveLength(1)
    expect(diff.removedEdges).toHaveLength(1)
  })

  it("detects config and label changes on shared nodes", () => {
    const before = baseGraph()
    const transform = before.nodes[1]
    const after = updateNode(before, transform.id, {
      label: "Normalize",
      config: { ...transform.config, operation: "uppercase" },
    })
    const diff = diffGraphs(before, after)
    expect(diff.changedNodes).toHaveLength(1)
    const fields = diff.changedNodes[0].changes.map((c) => c.field)
    expect(fields).toContain("label")
    expect(fields).toContain("config")
  })

  it("detects added edges", () => {
    const before = createEmptyGraph("E")
    const after = baseGraph()
    // Give them the same node ids so only edges differ.
    const alignedBefore: AutomationGraph = {
      ...before,
      nodes: after.nodes.map((n) => ({ ...n })),
    }
    const diff = diffGraphs(alignedBefore, after)
    expect(diff.addedEdges).toHaveLength(1)
    expect(summarizeDiff(diff).edgesAdded).toBe(1)
  })
})

describe("diffGraphs config key order", () => {
  it("treats configs with reordered keys as unchanged", () => {
    const before = baseGraph()
    const transform = before.nodes[1]
    const after: AutomationGraph = {
      ...before,
      nodes: before.nodes.map((n) =>
        n.id === transform.id
          ? { ...n, config: { template: "{{input}}", operation: "identity" } }
          : n,
      ),
    }
    // Same keys/values, different insertion order → not a change.
    const diff = diffGraphs(before, after)
    expect(diff.changedNodes).toHaveLength(0)
    expect(diff.unchanged).toBe(true)
  })
})
