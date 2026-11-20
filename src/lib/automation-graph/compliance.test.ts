import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  checkCompliance,
  createEmptyGraph,
  DEFAULT_COMPLIANCE_POLICY,
  updateNode,
} from "./index"
import type { AutomationGraph } from "./types"

function chain(
  types: string[],
  configs: Record<number, Record<string, unknown>> = {},
): AutomationGraph {
  let graph = createEmptyGraph("Compliance")
  types.forEach((type, i) => {
    graph = addNodeToGraph(graph, type, { x: i * 200, y: 0 })
    if (configs[i]) {
      const node = graph.nodes[graph.nodes.length - 1]
      graph = updateNode(graph, node.id, { config: { ...node.config, ...configs[i] } })
    }
  })
  for (let i = 0; i < types.length - 1; i++) {
    const source = graph.nodes[i]
    graph = addEdgeToGraph(graph, {
      sourceNodeId: source.id,
      // Condition nodes branch on "true"/"false" instead of "out".
      sourcePort: source.type === "condition" ? "true" : "out",
      targetNodeId: graph.nodes[i + 1].id,
      targetPort: "in",
    })
  }
  return graph
}

describe("checkCompliance", () => {
  it("passes a gated, logged graph under the default policy", () => {
    const graph = chain(["trigger.event", "condition", "action.log", "action.post-summary"], {
      2: { message: "step done", level: "info" },
    })
    const report = checkCompliance(graph)
    expect(report.publishable).toBe(true)
    expect(report.errorCount).toBe(0)
    const gate = report.checks.find((c) => c.id === "approval-gate")
    expect(gate?.passed).toBe(true)
  })

  it("blocks graphs with no trigger", () => {
    let graph = createEmptyGraph("No trigger")
    graph = addNodeToGraph(graph, "action.post-summary", { x: 0, y: 0 })
    const report = checkCompliance(graph)
    expect(report.publishable).toBe(false)
    expect(report.checks.find((c) => c.id === "has-trigger")?.passed).toBe(false)
  })

  it("fails the gate when only SOME actions are gated", () => {
    // trigger → condition → action.log (gated) AND trigger → post-summary (ungated)
    let graph = createEmptyGraph("Mixed")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "condition", { x: 200, y: 0 })
    graph = addNodeToGraph(graph, "action.log", { x: 400, y: 0 })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 400, y: 200 })
    graph = updateNode(graph, graph.nodes[2].id, { config: { message: "ok" } })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[1].id,
      sourcePort: "true",
      targetNodeId: graph.nodes[2].id,
      targetPort: "in",
    })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[3].id,
      targetPort: "in",
    })
    const report = checkCompliance(graph)
    const gate = report.checks.find((c) => c.id === "approval-gate")
    expect(gate?.passed).toBe(false)
    expect(gate?.detail).toContain("Post run summary")
  })

  it("warns (not blocks) on ungated actions under default policy", () => {
    const graph = chain(["trigger.schedule", "action.post-summary", "action.log"], {
      2: { message: "done" },
    })
    const report = checkCompliance(graph, DEFAULT_COMPLIANCE_POLICY)
    const gate = report.checks.find((c) => c.id === "approval-gate")
    expect(gate?.passed).toBe(false)
    expect(gate?.severity).toBe("warning")
    expect(report.publishable).toBe(true)
  })

  it("enforces forbidden and required node types", () => {
    const graph = chain(["trigger.schedule", "action.post-summary"])
    const report = checkCompliance(graph, {
      forbiddenNodeTypes: ["action.post-summary"],
      requiredNodeTypes: ["action.log"],
    })
    expect(report.publishable).toBe(false)
    expect(report.checks.find((c) => c.id === "forbidden-types")?.passed).toBe(false)
    expect(report.checks.find((c) => c.id === "required-action.log")?.passed).toBe(false)
  })

  it("supports prefix matching for node types", () => {
    const graph = chain(["trigger.schedule", "action.post-summary"])
    const report = checkCompliance(graph, { forbiddenNodeTypes: ["action.*"] })
    expect(report.checks.find((c) => c.id === "forbidden-types")?.passed).toBe(false)
  })

  it("enforces required config keys per node type", () => {
    let graph = chain(["trigger.schedule", "action.update-files"], {
      1: { target: "results/out.json" },
    })
    // Remove the retention tag → should fail.
    const policy = {
      requiredConfig: [
        { nodeTypePrefix: "action.update-files", key: "retentionTag", label: "Retention tag" },
      ],
    }
    let report = checkCompliance(graph, policy)
    expect(report.publishable).toBe(false)
    expect(report.checks.find((c) => c.id.includes("retentionTag"))?.passed).toBe(false)

    // Add the tag → passes.
    const node = graph.nodes[1]
    graph = updateNode(graph, node.id, {
      config: { ...node.config, retentionTag: "90d" },
    })
    report = checkCompliance(graph, policy)
    expect(report.publishable).toBe(true)
  })

  it("treats empty graphs leniently on the trigger check", () => {
    const report = checkCompliance(createEmptyGraph("Empty"))
    expect(report.checks.find((c) => c.id === "has-trigger")?.passed).toBe(true)
  })
})
