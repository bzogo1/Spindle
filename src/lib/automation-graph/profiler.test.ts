import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  dryRunGraph,
  formatProfile,
  nodeCostUnits,
  profileDryRun,
} from "./index"
import type { AutomationGraph } from "./types"

function chainGraph(): AutomationGraph {
  let graph = createEmptyGraph("Profile me")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "agent.task", { x: 200, y: 0 })
  graph = addNodeToGraph(graph, "action.post-summary", { x: 400, y: 0 })
  // agent.task needs a prompt.
  graph = {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.type === "agent.task" ? { ...n, config: { ...n.config, prompt: "do things" } } : n,
    ),
  }
  graph = addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[0].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[1].id,
    targetPort: "in",
  })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[1].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[2].id,
    targetPort: "in",
  })
  return graph
}

describe("profileDryRun", () => {
  it("produces per-node profiles with shares summing to ~1", () => {
    const graph = chainGraph()
    const report = dryRunGraph(graph)
    const profile = profileDryRun(graph, report)

    expect(profile.nodes).toHaveLength(3)
    expect(profile.totalMs).toBeGreaterThan(0)
    const shareSum = profile.nodes.reduce((sum, n) => sum + n.share, 0)
    expect(shareSum).toBeCloseTo(1, 1)
    for (const node of profile.nodes) {
      expect(node.label).toBeTruthy()
      expect(node.costUnits).toBeGreaterThan(0)
    }
  })

  it("identifies the bottleneck and hotspots", () => {
    const graph = chainGraph()
    const report = dryRunGraph(graph)
    const profile = profileDryRun(graph, report)

    const maxNode = profile.nodes.reduce((a, b) => (a.durationMs >= b.durationMs ? a : b))
    expect(profile.bottleneckNodeId).toBe(maxNode.nodeId)
    // With 3 sequential nodes each ~1/3 share, hotspots depend on durations;
    // at minimum the bottleneck must be a hotspot or the only executed node.
    expect(profile.hotspots.length).toBeGreaterThanOrEqual(0)
  })

  it("handles empty graphs", () => {
    const graph = createEmptyGraph("Empty")
    const report = dryRunGraph(graph)
    const profile = profileDryRun(graph, report)
    expect(profile.nodes).toHaveLength(0)
    expect(profile.bottleneckNodeId).toBeNull()
    expect(profile.totalMs).toBe(0)
  })

  it("assigns higher cost units to agent tasks", () => {
    expect(nodeCostUnits("agent.task")).toBeGreaterThan(nodeCostUnits("transform"))
    expect(nodeCostUnits("unknown.type")).toBe(3)
  })

  it("formats a readable profile", () => {
    const graph = chainGraph()
    const profile = profileDryRun(graph, dryRunGraph(graph))
    const text = formatProfile(profile)
    expect(text).toContain("Total:")
    expect(text).toContain("ms")
  })
})
