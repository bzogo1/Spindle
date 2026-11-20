import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  scanGraphSecurity,
  securitySummary,
  updateNode,
} from "./index"
import type { AutomationGraph } from "./types"

function graphWith(nodes: { type: string; config?: Record<string, unknown> }[]): AutomationGraph {
  let graph = createEmptyGraph("Scan")
  for (const spec of nodes) {
    graph = addNodeToGraph(graph, spec.type, { x: 0, y: 0 })
    if (spec.config) {
      const node = graph.nodes[graph.nodes.length - 1]
      graph = updateNode(graph, node.id, { config: { ...node.config, ...spec.config } })
    }
  }
  return graph
}

function chain(types: string[]): AutomationGraph {
  const specs = types.map((type) => ({ type }))
  let graph = graphWith(specs)
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

describe("scanGraphSecurity", () => {
  it("returns no findings for a clean gated graph", () => {
    let graph = chain(["trigger.schedule", "condition", "action.log"])
    graph = updateNode(graph, graph.nodes[2].id, { config: { message: "done", level: "info" } })
    const findings = scanGraphSecurity(graph)
    expect(findings).toHaveLength(0)
    expect(securitySummary(findings).clean).toBe(true)
  })

  it("flags secrets in config as critical", () => {
    let graph = chain(["trigger.schedule", "action.post-summary"])
    graph = updateNode(graph, graph.nodes[1].id, {
      config: { channel: "#x", apiToken: "sk-abcdefghijklmnopqrstuvwxyz" },
    })
    const findings = scanGraphSecurity(graph)
    const secret = findings.find((f) => f.rule === "secret-in-config")
    expect(secret?.severity).toBe("critical")
    expect(secret?.nodeId).toBe(graph.nodes[1].id)
  })

  it("flags secret-looking keys with long values", () => {
    const graph = graphWith([
      { type: "trigger.schedule" },
      { type: "action.post-summary", config: { password: "hunter2-hunter2" } },
    ])
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "secret-in-config")).toBe(true)
  })

  it("flags external URLs as SSRF-ish warnings", () => {
    const graph = graphWith([
      { type: "trigger.schedule" },
      { type: "action.update-files", config: { target: "https://evil.example.com/x" } },
    ])
    const findings = scanGraphSecurity(graph)
    const url = findings.find((f) => f.rule === "external-url")
    expect(url?.severity).toBe("warning")
  })

  it("flags injection patterns", () => {
    const graph = graphWith([
      { type: "trigger.schedule" },
      { type: "action.log", config: { message: "run `rm -rf /` now", level: "info" } },
    ])
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "injection-pattern")).toBe(true)
  })

  it("flags unvalidated event inputs", () => {
    const graph = chain(["trigger.event", "action.post-summary"])
    const findings = scanGraphSecurity(graph)
    const unvalidated = findings.find((f) => f.rule === "unvalidated-input")
    expect(unvalidated?.severity).toBe("warning")
    expect(unvalidated?.nodeId).toBe(graph.nodes[0].id)
  })

  it("does not flag event inputs when a condition exists", () => {
    const graph = chain(["trigger.event", "condition", "action.post-summary"])
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "unvalidated-input")).toBe(false)
  })

  it("flags ungated direct trigger→action edges", () => {
    const graph = chain(["trigger.schedule", "action.post-summary"])
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "ungated-action")).toBe(true)
  })

  it("flags missing logging for action-only graphs", () => {
    const graph = chain(["trigger.schedule", "condition", "action.post-summary"])
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "missing-logging")).toBe(true)
  })

  it("sorts critical findings first", () => {
    const graph = graphWith([
      { type: "trigger.schedule" },
      { type: "action.post-summary", config: { apiKey: "sk-aaaaaaaaaaaaaaaaaaaa" } },
      { type: "action.update-files", config: { target: "https://x.example.com" } },
    ])
    const findings = scanGraphSecurity(graph)
    expect(findings[0].severity).toBe("critical")
  })
})

describe("scanGraphSecurity edge cases", () => {
  it("gives unique ids to multiple findings on the same node", () => {
    const graph = graphWith([
      { type: "trigger.schedule" },
      {
        type: "action.post-summary",
        config: {
          channel: "#x",
          apiKey: "sk-aaaaaaaaaaaaaaaaaaaa",
          webhookUrl: "https://hooks.example.com/abc",
        },
      },
    ])
    const findings = scanGraphSecurity(graph)
    const ids = findings.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    // apiKey → secret-in-config; webhookUrl → external-url. Distinct rules
    // already differ, so force two same-rule findings via two secret fields.
    const graph2 = graphWith([
      { type: "trigger.schedule" },
      {
        type: "action.post-summary",
        config: {
          apiKey: "sk-aaaaaaaaaaaaaaaaaaaa",
          authToken: "sk-bbbbbbbbbbbbbbbbbbbb",
        },
      },
    ])
    const ids2 = scanGraphSecurity(graph2).map((f) => f.id)
    expect(new Set(ids2).size).toBe(ids2.length)
    expect(ids2.filter((id) => id.startsWith("secret-in-config"))).toHaveLength(2)
  })

  it("does not flag unvalidated input when no action is reachable", () => {
    // Event trigger → transform only (dead end, no action downstream).
    let graph = createEmptyGraph("Dead end")
    graph = addNodeToGraph(graph, "trigger.event", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "unvalidated-input")).toBe(false)
  })

  it("still flags unvalidated input when an agent task is reachable", () => {
    const graph = chain(["trigger.event", "agent.task"])
    const findings = scanGraphSecurity(graph)
    expect(findings.some((f) => f.rule === "unvalidated-input")).toBe(true)
  })
})
