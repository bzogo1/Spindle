import { beforeEach, describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  automationRunMetrics,
  clearAutomationRuns,
  createEmptyGraph,
  deleteAutomationRun,
  dryRunGraph,
  readAutomationRuns,
  recordAutomationRun,
  runLogStorageKey,
  RUN_LOG_MAX_ENTRIES,
} from "./index"
import type { AutomationGraph } from "./types"

function sampleGraph(): AutomationGraph {
  let graph = createEmptyGraph("Monitored")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "action.post-summary", { x: 200, y: 0 })
  graph = addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[0].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[1].id,
    targetPort: "in",
  })
  return graph
}

beforeEach(() => window.localStorage.clear())

describe("recordAutomationRun / readAutomationRuns", () => {
  it("records runs newest-first with metrics fields", () => {
    const graph = sampleGraph()
    const report = dryRunGraph(graph)
    const record = recordAutomationRun("scope", graph, report)

    expect(record.status).toBe("success")
    expect(record.graphName).toBe("Monitored")
    expect(record.total).toBe(2)
    expect(record.succeeded).toBe(2)
    expect(record.durationMs).toBeGreaterThan(0)

    const runs = readAutomationRuns("scope")
    expect(runs).toHaveLength(1)
    expect(runs[0].id).toBe(record.id)
    expect(window.localStorage.getItem(runLogStorageKey("scope"))).toBeTruthy()
  })

  it("scopes runs independently and limits reads", () => {
    const graph = sampleGraph()
    const report = dryRunGraph(graph)
    recordAutomationRun("a", graph, report)
    recordAutomationRun("b", graph, report)
    recordAutomationRun("a", graph, report)
    expect(readAutomationRuns("a")).toHaveLength(2)
    expect(readAutomationRuns("b")).toHaveLength(1)
    expect(readAutomationRuns("a", 1)).toHaveLength(1)
  })

  it("caps the log at RUN_LOG_MAX_ENTRIES", () => {
    const graph = sampleGraph()
    const report = dryRunGraph(graph)
    for (let i = 0; i < RUN_LOG_MAX_ENTRIES + 5; i++) {
      recordAutomationRun("cap", graph, report)
    }
    expect(readAutomationRuns("cap")).toHaveLength(RUN_LOG_MAX_ENTRIES)
  })

  it("delete and clear work", () => {
    const graph = sampleGraph()
    const report = dryRunGraph(graph)
    const r1 = recordAutomationRun("s", graph, report)
    recordAutomationRun("s", graph, report)
    deleteAutomationRun("s", r1.id)
    expect(readAutomationRuns("s")).toHaveLength(1)
    clearAutomationRuns("s")
    expect(readAutomationRuns("s")).toHaveLength(0)
    deleteAutomationRun("s", "nonexistent")
  })
})

describe("automationRunMetrics", () => {
  it("returns zeros for an empty scope", () => {
    const metrics = automationRunMetrics("empty")
    expect(metrics.totalRuns).toBe(0)
    expect(metrics.successRate).toBe(0)
    expect(metrics.lastStatus).toBeNull()
    expect(metrics.avgDurationMs).toBe(0)
  })

  it("aggregates success rate, durations, and last status", () => {
    const graph = sampleGraph()
    const good = dryRunGraph(graph)
    recordAutomationRun("m", graph, good)
    recordAutomationRun("m", graph, good)

    // Force a failing report.
    let badGraph = createEmptyGraph("Bad")
    badGraph = addNodeToGraph(badGraph, "trigger.schedule", { x: 0, y: 0 })
    badGraph = addNodeToGraph(badGraph, "action.post-summary", { x: 200, y: 0 })
    badGraph = {
      ...badGraph,
      nodes: badGraph.nodes.map((n, i) =>
        i === 1 ? { ...n, config: { ...n.config, simulateError: true } } : n,
      ),
    }
    badGraph = addEdgeToGraph(badGraph, {
      sourceNodeId: badGraph.nodes[0].id,
      sourcePort: "out",
      targetNodeId: badGraph.nodes[1].id,
      targetPort: "in",
    })
    recordAutomationRun("m", badGraph, dryRunGraph(badGraph))

    const metrics = automationRunMetrics("m")
    expect(metrics.totalRuns).toBe(3)
    expect(metrics.successCount).toBe(2)
    expect(metrics.failureCount).toBe(1)
    expect(metrics.successRate).toBeCloseTo(2 / 3)
    expect(metrics.lastStatus).toBe("error")
    expect(metrics.lastRunAt).toBeTruthy()
    expect(metrics.avgDurationMs).toBeGreaterThan(0)
    expect(metrics.recent).toHaveLength(3)
  })
})
