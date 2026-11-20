import { describe, expect, it } from "vitest"

import { addEdgeToGraph, addNodeToGraph, createEmptyGraph, updateNode } from "./graph"
import { dryRunGraph } from "./dry-run"
import type { AutomationGraph } from "./types"

function buildLinearGraph(): { graph: AutomationGraph; ids: string[] } {
  let graph = createEmptyGraph("Pipeline")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "transform", { x: 280, y: 0 })
  graph = addNodeToGraph(graph, "condition", { x: 560, y: 0 })
  graph = addNodeToGraph(graph, "action.post-summary", { x: 840, y: -120 })
  graph = addNodeToGraph(graph, "action.update-files", { x: 840, y: 120 })
  const [t, tr, cond, summary, files] = graph.nodes

  graph = addEdgeToGraph(graph, {
    sourceNodeId: t.id,
    sourcePort: "out",
    targetNodeId: tr.id,
    targetPort: "in",
  })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: tr.id,
    sourcePort: "out",
    targetNodeId: cond.id,
    targetPort: "in",
  })
  // condition config: pass when payload.kind === "schedule" (default payload)
  graph = updateNode(graph, cond.id, {
    config: { field: "kind", operator: "equals", value: "schedule" },
  })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: cond.id,
    sourcePort: "true",
    targetNodeId: summary.id,
    targetPort: "in",
  })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: cond.id,
    sourcePort: "false",
    targetNodeId: files.id,
    targetPort: "in",
  })
  return { graph, ids: [t.id, tr.id, cond.id, summary.id, files.id] }
}

describe("dryRunGraph", () => {
  it("executes a linear graph to success", () => {
    const { graph, ids } = buildLinearGraph()
    const report = dryRunGraph(graph, { seed: 42 })

    expect(report.status).toBe("success")
    expect(report.order).toHaveLength(ids.length)
    expect(new Set(report.order)).toEqual(new Set(ids))
    const byId = new Map(report.results.map((r) => [r.nodeId, r]))
    for (const id of ids) {
      expect(byId.get(id)?.status).toBeDefined()
    }
    // Trigger + transform + condition + the taken branch action succeed.
    expect(byId.get(ids[0])?.status).toBe("success")
    expect(byId.get(ids[1])?.status).toBe("success")
    expect(byId.get(ids[2])?.status).toBe("success")
    expect(report.summary.succeeded + report.summary.skipped).toBe(report.summary.total)
    expect(report.summary.failed).toBe(0)
  })

  it("skips the untaken branch of a condition", () => {
    const { graph, ids } = buildLinearGraph()
    const report = dryRunGraph(graph, { seed: 1 })
    const byId = new Map(report.results.map((r) => [r.nodeId, r]))
    // Default schedule payload has kind="schedule" → true branch runs,
    // false branch (update-files) is skipped.
    expect(byId.get(ids[3])?.status).toBe("success")
    expect(byId.get(ids[4])?.status).toBe("skipped")
    expect(report.summary.skipped).toBe(1)
  })

  it("routes the false branch when the condition fails", () => {
    const { graph, ids } = buildLinearGraph()
    const report = dryRunGraph(graph, {
      seed: 1,
      triggerPayloads: { [ids[0]]: { kind: "manual" } },
    })
    const byId = new Map(report.results.map((r) => [r.nodeId, r]))
    expect(byId.get(ids[3])?.status).toBe("skipped")
    expect(byId.get(ids[4])?.status).toBe("success")
  })

  it("rejects graphs containing a cycle", () => {
    let graph = createEmptyGraph("Bad")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 280, y: 0 })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    // Force a cycle past canConnect.
    graph.edges.push({
      id: "e_bad",
      sourceNodeId: graph.nodes[1].id,
      sourcePort: "out",
      targetNodeId: graph.nodes[1].id,
      targetPort: "in",
    })
    const report = dryRunGraph(graph)
    expect(report.status).toBe("rejected")
    expect(report.issues.some((i) => i.code === "cycle" || i.code === "self-loop")).toBe(true)
  })

  it("propagates errors and skips downstream nodes", () => {
    let graph = createEmptyGraph("Fail")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 280, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 560, y: 0 })
    const [t, action, tr] = graph.nodes

    graph = addEdgeToGraph(graph, {
      sourceNodeId: t.id,
      sourcePort: "out",
      targetNodeId: action.id,
      targetPort: "in",
    })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: action.id,
      sourcePort: "out",
      targetNodeId: tr.id,
      targetPort: "in",
    })
    graph = updateNode(graph, action.id, {
      config: { channel: "#ops", simulateError: true },
    })

    const report = dryRunGraph(graph, { seed: 7 })
    const byId = new Map(report.results.map((r) => [r.nodeId, r]))
    expect(byId.get(t.id)?.status).toBe("success")
    expect(byId.get(action.id)?.status).toBe("error")
    expect(byId.get(action.id)?.error).toMatch(/Simulated failure/)
    expect(byId.get(tr.id)?.status).toBe("skipped")
    expect(report.status).toBe("error")
    expect(report.summary.failed).toBe(1)
    expect(report.summary.skipped).toBe(1)
  })

  it("supports trigger payload overrides", () => {
    const { graph, ids } = buildLinearGraph()
    const report = dryRunGraph(graph, {
      seed: 3,
      triggerPayloads: { [ids[0]]: { kind: "schedule", extra: 1 } },
    })
    const triggerResult = report.results.find((r) => r.nodeId === ids[0])
    expect(triggerResult?.output).toEqual({ kind: "schedule", extra: 1 })
  })

  it("runs a webhook trigger into a webhook action", () => {
    let graph = createEmptyGraph("Hooks")
    graph = addNodeToGraph(graph, "trigger.webhook", { x: 0, y: 0 })
    graph = updateNode(graph, graph.nodes[0].id, {
      config: {
        url: "https://api.example.com/hooks/automation",
        secret: "whsec_test",
        events: "deploy.finished",
        payload: "",
      },
    })
    graph = addNodeToGraph(graph, "action.webhook", { x: 280, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, {
      config: {
        url: "https://api.example.com/hooks/run",
        method: "POST",
        secret: "whsec_out",
        simulateError: false,
      },
    })
    const [trigger, action] = graph.nodes
    graph = addEdgeToGraph(graph, {
      sourceNodeId: trigger.id,
      sourcePort: "out",
      targetNodeId: action.id,
      targetPort: "in",
    })

    const report = dryRunGraph(graph, { seed: 5 })
    const byId = new Map(report.results.map((r) => [r.nodeId, r]))
    expect(report.status).toBe("success")
    expect(byId.get(trigger.id)?.status).toBe("success")
    expect(byId.get(trigger.id)?.output).toMatchObject({ kind: "webhook" })
    expect(byId.get(action.id)?.status).toBe("success")
    expect(byId.get(action.id)?.output).toMatchObject({
      delivered: true,
      url: "https://api.example.com/hooks/run",
      method: "POST",
      signed: true,
    })
  })

  it("rejects webhook nodes with invalid URLs during the dry run", () => {
    let graph = createEmptyGraph("Bad hooks")
    graph = addNodeToGraph(graph, "trigger.webhook", { x: 0, y: 0 })
    graph = updateNode(graph, graph.nodes[0].id, {
      config: { url: "not a url", secret: "", events: "", payload: "" },
    })
    const report = dryRunGraph(graph, { seed: 1 })
    expect(report.results[0]?.status).toBe("error")
    expect(report.results[0]?.error).toMatch(/absolute http\(s\) URL/)
  })

  it("errors the webhook action on a non-http URL", () => {
    let graph = createEmptyGraph("Bad action")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "action.webhook", { x: 280, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, {
      config: { url: "ftp://example.com/hook", method: "POST", secret: "", simulateError: false },
    })
    const [trigger, action] = graph.nodes
    graph = addEdgeToGraph(graph, {
      sourceNodeId: trigger.id,
      sourcePort: "out",
      targetNodeId: action.id,
      targetPort: "in",
    })

    const report = dryRunGraph(graph, { seed: 2 })
    const byId = new Map(report.results.map((r) => [r.nodeId, r]))
    expect(byId.get(action.id)?.status).toBe("error")
    expect(byId.get(action.id)?.error).toMatch(/http or https/)
    expect(report.status).toBe("error")
  })

  it("is deterministic for a fixed seed", () => {
    const { graph } = buildLinearGraph()
    const a = dryRunGraph(graph, { seed: 99 })
    const b = dryRunGraph(graph, { seed: 99 })
    expect(a.results.map((r) => [r.status, r.durationMs, r.startedAtMs])).toEqual(
      b.results.map((r) => [r.status, r.durationMs, r.startedAtMs]),
    )
  })
})
