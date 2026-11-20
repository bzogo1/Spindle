"use client"

import {
  dryRunGraph,
  type DryRunOptions,
  type DryRunReport,
  type DryRunStatus,
  type NodeRunStatus,
} from "./dry-run"
import { getNode } from "./graph"
import type { AutomationGraph } from "./types"

/**
 * Rule-based test runner for automation graphs. Test cases supply trigger
 * payload overrides and expectations about the dry-run outcome; each case is
 * executed with the same deterministic dry-run engine used by the builder.
 */

export interface AutomationTestCase {
  id: string
  name: string
  description?: string
  /** Per-trigger-node payload overrides, keyed by node id or node label. */
  triggerPayloads?: Record<string, unknown>
  expect: {
    /** Expected overall dry-run status. */
    status?: DryRunStatus
    /** Expected per-node status, keyed by node id or label. */
    nodeStatuses?: Record<string, NodeRunStatus>
    /** Substrings expected in a node's JSON-serialized output. */
    outputContains?: Record<string, string>
  }
}

export interface TestCaseResult {
  caseId: string
  name: string
  passed: boolean
  failures: string[]
  report: DryRunReport
}

export interface TestRunSummary {
  total: number
  passed: number
  failed: number
  /** Fraction of graph nodes exercised (ran to success/error) by ≥1 case. */
  nodeCoverage: number
  /** Node ids covered by at least one executed case. */
  coveredNodeIds: string[]
}

export interface TestRunReport {
  graphId: string
  results: TestCaseResult[]
  summary: TestRunSummary
}

let caseCounter = 0
export function createTestCaseId(): string {
  caseCounter += 1
  return `tc_${Date.now().toString(36)}_${caseCounter}`
}

export function createTestCase(name = "New case"): AutomationTestCase {
  return {
    id: createTestCaseId(),
    name,
    expect: {},
  }
}

/** Resolve a node-status expectation key (id or label) to a node id. */
function resolveNodeId(graph: AutomationGraph, key: string): string {
  const byId = getNode(graph, key)
  if (byId) return byId.id
  const byLabel = graph.nodes.find((node) => node.label === key || node.type === key)
  return byLabel?.id ?? key
}

/** Normalize trigger payload keys (ids or labels) to node ids. */
export function resolveTriggerPayloads(
  graph: AutomationGraph,
  payloads: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payloads) return undefined
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payloads)) {
    resolved[resolveNodeId(graph, key)] = value
  }
  return resolved
}

function evaluateCase(graph: AutomationGraph, testCase: AutomationTestCase): TestCaseResult {
  const failures: string[] = []
  const options: DryRunOptions = {
    triggerPayloads: resolveTriggerPayloads(graph, testCase.triggerPayloads),
    seed: 7,
  }
  const report = dryRunGraph(graph, options)
  const expect = testCase.expect ?? {}

  if (expect.status && report.status !== expect.status) {
    failures.push(`Expected overall status "${expect.status}", got "${report.status}".`)
  }

  const resultsByNode = new Map(report.results.map((result) => [result.nodeId, result]))

  for (const [key, expectedStatus] of Object.entries(expect.nodeStatuses ?? {})) {
    const nodeId = resolveNodeId(graph, key)
    const result = resultsByNode.get(nodeId)
    if (!result) {
      failures.push(`Expected node "${key}" to run, but it produced no result.`)
      continue
    }
    if (result.status !== expectedStatus) {
      failures.push(
        `Expected node "${getNode(graph, nodeId)?.label ?? key}" to be "${expectedStatus}", got "${result.status}".`,
      )
    }
  }

  for (const [key, needle] of Object.entries(expect.outputContains ?? {})) {
    const nodeId = resolveNodeId(graph, key)
    const result = resultsByNode.get(nodeId)
    const serialized = result?.output === undefined ? "" : safeStringify(result.output)
    if (!serialized.includes(needle)) {
      failures.push(
        `Expected output of "${getNode(graph, nodeId)?.label ?? key}" to contain "${needle}", got ${serialized || "nothing"}.`,
      )
    }
  }

  return {
    caseId: testCase.id,
    name: testCase.name,
    passed: failures.length === 0,
    failures,
    report,
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Run every test case against the graph and compute node coverage. */
export function runAutomationTests(
  graph: AutomationGraph,
  cases: AutomationTestCase[],
): TestRunReport {
  const results = cases.map((testCase) => evaluateCase(graph, testCase))

  const covered = new Set<string>()
  for (const result of results) {
    for (const nodeResult of result.report.results) {
      if (nodeResult.status === "success" || nodeResult.status === "error") {
        covered.add(nodeResult.nodeId)
      }
    }
  }
  const total = graph.nodes.length
  const coveredNodeIds = [...covered]
  const nodeCoverage = total === 0 ? 1 : covered.size / total

  return {
    graphId: graph.id,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      nodeCoverage,
      coveredNodeIds,
    },
  }
}

/* ------------------------------------------------------------------------ */
/* Persistence (localStorage, scoped per graph like version history)        */
/* ------------------------------------------------------------------------ */

const STORAGE_PREFIX = "spindle.automation-tests.v1."

export function testCasesStorageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`
}

function isTestCase(value: unknown): value is AutomationTestCase {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<AutomationTestCase>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.expect === undefined || typeof candidate.expect === "object")
  )
}

/** Stored test cases for a scope. SSR- and test-safe (returns []). */
export function readTestCases(scope: string): AutomationTestCase[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(testCasesStorageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isTestCase) : []
  } catch {
    return []
  }
}

export function writeTestCases(scope: string, cases: AutomationTestCase[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(testCasesStorageKey(scope), JSON.stringify(cases))
  } catch {
    // Storage unavailable — cases just won't persist.
  }
}

/** Build a starter case: every trigger emits its sample payload, run succeeds. */
export function starterTestCase(graph: AutomationGraph): AutomationTestCase {
  const triggerPayloads: Record<string, unknown> = {}
  for (const node of graph.nodes) {
    if (node.type.startsWith("trigger.")) {
      triggerPayloads[node.id] = { source: "test-case", node: node.label }
    }
  }
  return {
    id: createTestCaseId(),
    name: "Happy path",
    description: "All triggers fire with a minimal payload; every reachable node succeeds.",
    triggerPayloads: Object.keys(triggerPayloads).length ? triggerPayloads : undefined,
    expect: { status: "success" },
  }
}
