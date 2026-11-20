import { beforeEach, describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  createTestCase,
  readTestCases,
  runAutomationTests,
  starterTestCase,
  testCasesStorageKey,
  writeTestCases,
  type AutomationTestCase,
} from "./index"
import type { AutomationGraph } from "./types"

function twoNodeGraph(): AutomationGraph {
  let graph = createEmptyGraph("Testable")
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

function failingGraph(): AutomationGraph {
  let graph = createEmptyGraph("Failing")
  graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
  graph = addNodeToGraph(graph, "action.post-summary", { x: 200, y: 0 })
  graph = {
    ...graph,
    nodes: graph.nodes.map((n, i) =>
      i === 1 ? { ...n, config: { ...n.config, simulateError: true } } : n,
    ),
  }
  graph = addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[0].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[1].id,
    targetPort: "in",
  })
  return graph
}

describe("runAutomationTests", () => {
  it("passes a happy-path case and computes coverage", () => {
    const graph = twoNodeGraph()
    const testCase = starterTestCase(graph)
    const report = runAutomationTests(graph, [testCase])

    expect(report.summary.total).toBe(1)
    expect(report.summary.passed).toBe(1)
    expect(report.summary.failed).toBe(0)
    expect(report.summary.nodeCoverage).toBe(1)
    expect(report.results[0].report.status).toBe("success")
  })

  it("fails when expected status does not match", () => {
    const graph = failingGraph()
    const testCase: AutomationTestCase = {
      ...createTestCase("Should fail"),
      expect: { status: "success" },
    }
    const report = runAutomationTests(graph, [testCase])
    expect(report.summary.failed).toBe(1)
    expect(report.results[0].passed).toBe(false)
    expect(report.results[0].failures[0]).toMatch(/Expected overall status/)
  })

  it("passes when the expected error status matches", () => {
    const graph = failingGraph()
    const testCase: AutomationTestCase = {
      ...createTestCase("Expect failure"),
      expect: { status: "error" },
    }
    const report = runAutomationTests(graph, [testCase])
    expect(report.summary.passed).toBe(1)
  })

  it("checks per-node statuses by label and output contents", () => {
    const graph = twoNodeGraph()
    const action = graph.nodes[1]
    const testCase: AutomationTestCase = {
      ...createTestCase("Node checks"),
      expect: {
        nodeStatuses: { "Post run summary": "success" },
        outputContains: { [action.id]: '"posted":true' },
      },
    }
    const report = runAutomationTests(graph, [testCase])
    expect(report.results[0].passed).toBe(true)

    const badCase: AutomationTestCase = {
      ...createTestCase("Bad output"),
      expect: { outputContains: { [action.id]: "nonexistent-token" } },
    }
    const badReport = runAutomationTests(graph, [badCase])
    expect(badReport.results[0].passed).toBe(false)
    expect(badReport.results[0].failures[0]).toMatch(/to contain/)
  })

  it("applies trigger payload overrides", () => {
    // trigger → transform(identity) → action: the transform echoes the
    // trigger payload, so outputContains can observe the override.
    let graph = createEmptyGraph("Payload")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = addNodeToGraph(graph, "transform", { x: 200, y: 0 })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 400, y: 0 })
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
    const testCase: AutomationTestCase = {
      ...createTestCase("Payload"),
      triggerPayloads: { [graph.nodes[0].label]: { hello: "world" } },
      expect: {
        outputContains: { [graph.nodes[1].id]: "world" },
      },
    }
    const report = runAutomationTests(graph, [testCase])
    expect(report.results[0].passed).toBe(true)
  })

  it("computes partial node coverage across cases", () => {
    const graph = twoNodeGraph()
    const report = runAutomationTests(graph, [starterTestCase(graph)])
    expect(report.summary.coveredNodeIds).toHaveLength(2)
    expect(report.summary.nodeCoverage).toBe(1)
  })
})

describe("test case persistence", () => {
  beforeEach(() => window.localStorage.clear())

  it("round-trips cases through localStorage", () => {
    const cases = [createTestCase("A"), createTestCase("B")]
    writeTestCases("scope-1", cases)
    const read = readTestCases("scope-1")
    expect(read.map((c) => c.name)).toEqual(["A", "B"])
    expect(window.localStorage.getItem(testCasesStorageKey("scope-1"))).toBeTruthy()
  })

  it("returns [] for empty/invalid storage and scopes independently", () => {
    expect(readTestCases("missing")).toEqual([])
    writeTestCases("s1", [createTestCase("one")])
    writeTestCases("s2", [createTestCase("two")])
    expect(readTestCases("s1")).toHaveLength(1)
    expect(readTestCases("s2")[0].name).toBe("two")
    window.localStorage.setItem(testCasesStorageKey("bad"), "{not json")
    expect(readTestCases("bad")).toEqual([])
  })
})

describe("starterTestCase", () => {
  it("builds a success expectation with trigger payloads", () => {
    const graph = twoNodeGraph()
    const testCase = starterTestCase(graph)
    expect(testCase.expect.status).toBe("success")
    expect(testCase.triggerPayloads).toBeDefined()
    expect(Object.keys(testCase.triggerPayloads ?? {})).toHaveLength(1)
  })
})
