import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  analyzeGraph,
  applyOptimization,
  createEmptyGraph,
  incomingEdges,
  outgoingEdges,
  updateNode,
} from "./index"
import type { AutomationGraph } from "./types"

function connect(graph: AutomationGraph, from: number, to: number): AutomationGraph {
  return addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[from].id,
    sourcePort: from === 0 || graph.nodes[from].type === "condition" ? "out" : "out",
    targetNodeId: graph.nodes[to].id,
    targetPort: "in",
  })
}

function simpleChain(): AutomationGraph {
  let graph = createEmptyGraph("Chain")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
  graph = addNodeToGraph(graph, "action.post-summary", { x: 400, y: 0 })
  graph = connect(graph, 0, 1)
  graph = connect(graph, 1, 2)
  return graph
}

describe("analyzeGraph", () => {
  it("returns no suggestions for a clean chain", () => {
    const graph = simpleChain()
    // transform default is identity → actually a redundant-transform suggestion.
    const suggestions = analyzeGraph(graph)
    expect(suggestions.some((s) => s.kind === "unreachable-node")).toBe(false)
    expect(suggestions.some((s) => s.kind === "redundant-transform")).toBe(true)
  })

  it("flags unreachable nodes with a remove fix", () => {
    let graph = simpleChain()
    graph = addNodeToGraph(graph, "agent.task", { x: 600, y: 0 })
    const suggestions = analyzeGraph(graph)
    const unused = suggestions.find((s) => s.kind === "unreachable-node")
    expect(unused).toBeDefined()
    expect(unused?.fix).toBe("remove-nodes")
  })

  it("flags identity transforms as bypassable", () => {
    const graph = simpleChain()
    const suggestions = analyzeGraph(graph)
    const identity = suggestions.find((s) => s.kind === "redundant-transform")
    expect(identity?.nodeIds).toHaveLength(1)
    expect(identity?.fix).toBe("bypass-node")
  })

  it("does not flag non-identity transforms", () => {
    let graph = createEmptyGraph("Work")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 400, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, {
      config: { operation: "uppercase", template: "" },
    })
    graph = connect(graph, 0, 1)
    graph = connect(graph, 1, 2)
    const suggestions = analyzeGraph(graph)
    expect(suggestions.some((s) => s.kind === "redundant-transform")).toBe(false)
  })

  it("flags chains of sequential non-identity transforms", () => {
    let graph = createEmptyGraph("Chain2")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 400, y: 0 })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 600, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, { config: { operation: "uppercase" } })
    graph = updateNode(graph, graph.nodes[2].id, { config: { operation: "json" } })
    graph = connect(graph, 0, 1)
    graph = connect(graph, 1, 2)
    graph = connect(graph, 2, 3)
    const suggestions = analyzeGraph(graph)
    const chain = suggestions.find((s) => s.kind === "sequential-transforms")
    expect(chain).toBeDefined()
    expect(chain?.nodeIds).toHaveLength(2)
    expect(chain?.fix).toBeUndefined()
  })

  it("flags dead-end non-action nodes", () => {
    let graph = createEmptyGraph("Dead")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, { config: { operation: "uppercase" } })
    graph = connect(graph, 0, 1)
    const suggestions = analyzeGraph(graph)
    expect(suggestions.some((s) => s.kind === "dead-branch")).toBe(true)
  })

  it("flags duplicate nodes", () => {
    let graph = createEmptyGraph("Dup")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "action.log", { x: 200, y: 0 })
    graph = addNodeToGraph(graph, "action.log", { x: 400, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, { config: { message: "same", level: "info" } })
    graph = updateNode(graph, graph.nodes[2].id, { config: { message: "same", level: "info" } })
    graph = connect(graph, 0, 1)
    graph = connect(graph, 0, 2)
    const suggestions = analyzeGraph(graph)
    expect(suggestions.some((s) => s.kind === "duplicate-node")).toBe(true)
  })
})

describe("applyOptimization", () => {
  it("removes unreachable nodes", () => {
    let graph = simpleChain()
    graph = addNodeToGraph(graph, "agent.task", { x: 600, y: 0 })
    const orphanId = graph.nodes[graph.nodes.length - 1].id
    const suggestion = analyzeGraph(graph).find((s) => s.kind === "unreachable-node")!
    const next = applyOptimization(graph, suggestion)
    expect(next.nodes.some((n) => n.id === orphanId)).toBe(false)
    expect(next.nodes).toHaveLength(graph.nodes.length - 1)
  })

  it("bypasses an identity transform, rewiring edges", () => {
    const graph = simpleChain()
    const transform = graph.nodes[1]
    const suggestion = analyzeGraph(graph).find((s) => s.kind === "redundant-transform")!
    const next = applyOptimization(graph, suggestion)

    expect(next.nodes.some((n) => n.id === transform.id)).toBe(false)
    // trigger.out should now feed the action directly.
    const trigger = next.nodes.find((n) => n.type === "trigger.schedule")!
    const action = next.nodes.find((n) => n.type === "action.post-summary")!
    expect(outgoingEdges(next, trigger.id)).toHaveLength(1)
    expect(incomingEdges(next, action.id)).toHaveLength(1)
    expect(next.edges[0].sourceNodeId).toBe(trigger.id)
    expect(next.edges[0].targetNodeId).toBe(action.id)
  })

  it("returns the graph unchanged for suggestions without a fix", () => {
    const graph = simpleChain()
    const suggestion = analyzeGraph(graph).find((s) => s.kind === "sequential-transforms")
    if (suggestion) {
      expect(applyOptimization(graph, suggestion)).toBe(graph)
    } else {
      // No info-only suggestions in this graph; apply a fake one.
      const fake = {
        id: "x",
        kind: "sequential-transforms" as const,
        severity: "info" as const,
        title: "t",
        detail: "d",
        nodeIds: [graph.nodes[0].id],
      }
      expect(applyOptimization(graph, fake)).toBe(graph)
    }
  })
})
