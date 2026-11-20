import { getNodeType, isTriggerType, BRANCH_NODE_TYPE } from "./registry"
import {
  getInputPort,
  getNode,
  getOutputPort,
  incomingEdges,
  topologicalSort,
  validateGraph,
} from "./graph"
import type { AutomationGraph, GraphIssue, GraphNode } from "./types"

export type NodeRunStatus = "pending" | "running" | "success" | "error" | "skipped"

export interface NodeRunResult {
  nodeId: string
  status: NodeRunStatus
  /** Simulated start offset in ms from the start of the run. */
  startedAtMs: number
  durationMs: number
  logs: string[]
  /** Value this node produced for downstream nodes. */
  output?: unknown
  /** First value received on each input port (used by the debugger/inspector). */
  inputs?: Record<string, unknown>
  error?: string
}

export type DryRunStatus = "success" | "error" | "rejected"

export interface DryRunReport {
  graphId: string
  status: DryRunStatus
  issues: GraphIssue[]
  /** Node ids in execution order (topological). */
  order: string[]
  results: NodeRunResult[]
  summary: {
    total: number
    succeeded: number
    failed: number
    skipped: number
  }
}

export interface DryRunOptions {
  /**
   * Override the payload a trigger node emits, keyed by node id. Useful for
   * simulating different events without editing node config.
   */
  triggerPayloads?: Record<string, unknown>
  /** Deterministic seed for simulated durations/logs. */
  seed?: number
}

interface SimContext {
  node: GraphNode
  graph: AutomationGraph
  /** portId -> values arriving on that input port (active edges only). */
  inputs: Map<string, unknown[]>
  triggerPayloads: Record<string, unknown>
  log: (message: string) => void
}

interface SimResult {
  output: unknown
}

function str(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function firstInput(ctx: SimContext, portId = "in"): unknown {
  const values = ctx.inputs.get(portId)
  return values && values.length > 0 ? values[0] : undefined
}

function parsePayload(config: Record<string, unknown>, fallback: unknown): unknown {
  const raw = config.payload
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error(`Invalid JSON in sample payload: ${raw.slice(0, 60)}`)
    }
  }
  return fallback
}

function resolveField(value: unknown, path: string): unknown {
  if (!path) return value
  let current: unknown = value
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function compareValues(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "not-equals":
      return !looseEquals(actual, expected)
    case "contains":
      return str(actual).includes(str(expected))
    case "greater-than":
      return Number(actual) > Number(expected)
    case "less-than":
      return Number(actual) < Number(expected)
    case "truthy":
      return Boolean(actual)
    case "equals":
    default:
      return looseEquals(actual, expected)
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  // Intentionally loose: condition operands compare across string/number types.
  return a == b || str(a) === str(b)
}

function simulateTrigger(ctx: SimContext): SimResult {
  const { node } = ctx
  const kind =
    node.type === "trigger.schedule"
      ? "schedule"
      : node.type === "trigger.webhook"
        ? "webhook"
        : "event"
  const label =
    kind === "schedule"
      ? `cron "${str(node.config.cron) || "?"}"`
      : kind === "webhook"
        ? `webhook "${str(node.config.url) || "?"}"`
        : `event "${str(node.config.event) || "?"}"`
  if (kind === "webhook") {
    const url = str(node.config.url)
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error()
    } catch {
      throw new Error(`Webhook trigger requires an absolute http(s) URL, got "${url}".`)
    }
  }
  ctx.log(`Trigger fired (${label}).`)

  const override = ctx.triggerPayloads[node.id]
  const output =
    override !== undefined
      ? override
      : parsePayload(node.config, {
          kind,
          at: "2026-01-01T00:00:00.000Z",
          ...(kind === "schedule"
            ? { cron: node.config.cron }
            : kind === "webhook"
              ? { url: node.config.url, events: node.config.events }
              : { event: node.config.event }),
        })
  ctx.log(`Emitted payload: ${str(output).slice(0, 120)}`)
  return { output }
}

function simulateTransform(ctx: SimContext): SimResult {
  const input = firstInput(ctx)
  const operation = str(ctx.node.config.operation) || "identity"
  ctx.log(`Transform "${operation}" received ${str(input).slice(0, 80)}`)
  switch (operation) {
    case "uppercase":
      return { output: str(input).toUpperCase() }
    case "json":
      return { output: JSON.stringify(input) }
    case "template": {
      const template = str(ctx.node.config.template) || "{{input}}"
      return { output: template.replaceAll("{{input}}", str(input)) }
    }
    case "identity":
    default:
      return { output: input }
  }
}

function simulateCondition(ctx: SimContext): SimResult {
  const input = firstInput(ctx)
  const field = str(ctx.node.config.field)
  const operator = str(ctx.node.config.operator) || "equals"
  const expected = ctx.node.config.value
  const actual = resolveField(input, field)
  const result = compareValues(actual, operator, expected)
  ctx.log(
    `Condition ${field ? `on "${field}" ` : ""}${operator} ${str(expected)} → ${result ? "true" : "false"} (got ${str(actual)})`,
  )
  return { output: { value: input, branch: result ? "true" : "false" } }
}

function simulateAction(ctx: SimContext): SimResult {
  const { node } = ctx
  const input = firstInput(ctx)

  if (node.config.simulateError === true) {
    throw new Error(`Simulated failure on "${node.label}".`)
  }

  switch (node.type) {
    case "action.post-summary": {
      const channel = str(node.config.channel) || "#project-updates"
      ctx.log(`Posting run summary to ${channel}.`)
      ctx.log(`Summary input: ${str(input).slice(0, 100)}`)
      return { output: { posted: true, channel } }
    }
    case "action.update-files": {
      const target = str(node.config.target) || "results/summary.json"
      ctx.log(`Writing normalized output to ${target}.`)
      ctx.log(`Payload size: ${str(input).length} chars`)
      return { output: { written: true, path: target } }
    }
    case "action.log": {
      const level = str(node.config.level) || "info"
      const message = str(node.config.message)
      if (!message) throw new Error("Log entry requires a message.")
      ctx.log(`[${level}] ${message}`)
      ctx.log(`Log input: ${str(input).slice(0, 100)}`)
      return { output: { logged: true, level, message } }
    }
    case "action.webhook": {
      const url = str(node.config.url)
      if (!url) throw new Error("Webhook action requires a URL.")
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error(`Webhook URL is not a valid absolute URL: "${url}".`)
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Webhook URL must use http or https: "${url}".`)
      }
      const method = str(node.config.method) || "POST"
      const signed = Boolean(str(node.config.secret))
      ctx.log(`Delivering ${method} webhook to ${url}${signed ? " (signed)" : ""}.`)
      ctx.log(`Payload: ${str(input).slice(0, 100)}`)
      return { output: { delivered: true, url, method, signed, status: 202 } }
    }
    case "agent.task": {
      const prompt = str(node.config.prompt)
      if (!prompt) throw new Error("Agent task requires a prompt.")
      ctx.log(`Dispatching agent task: "${prompt.slice(0, 80)}"`)
      ctx.log("Agent completed (simulated).")
      return { output: { completed: true, prompt } }
    }
    default:
      throw new Error(`No dry-run simulator for node type "${node.type}".`)
  }
}

const SIMULATORS: Record<string, (ctx: SimContext) => SimResult> = {
  "trigger.schedule": simulateTrigger,
  "trigger.event": simulateTrigger,
  "trigger.webhook": simulateTrigger,
  transform: simulateTransform,
  condition: simulateCondition,
  "action.post-summary": simulateAction,
  "action.update-files": simulateAction,
  "action.log": simulateAction,
  "action.webhook": simulateAction,
  "agent.task": simulateAction,
}

/** Small deterministic PRNG so dry-run timings are stable for a given graph. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Simulate executing the graph. Pure and side-effect free: produces a report
 * describing what would have happened, including per-node logs and outputs.
 *
 * Execution model:
 *  - The graph must pass `validateGraph` (cycles and bad edges reject the run).
 *  - Nodes execute in topological order.
 *  - A condition node activates only its taken output branch; nodes reachable
 *    solely through the untaken branch are reported as "skipped".
 *  - A node whose active upstream failed is "skipped" (error propagation).
 */
export function dryRunGraph(graph: AutomationGraph, options: DryRunOptions = {}): DryRunReport {
  const issues = validateGraph(graph)
  if (issues.some((issue) => issue.severity === "error")) {
    return {
      graphId: graph.id,
      status: "rejected",
      issues,
      order: [],
      results: graph.nodes.map((node) => ({
        nodeId: node.id,
        status: "pending" as const,
        startedAtMs: 0,
        durationMs: 0,
        logs: [],
      })),
      summary: {
        total: graph.nodes.length,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
    }
  }

  const { order, cyclic } = topologicalSort(graph)
  // Validation guarantees acyclic, but guard anyway for direct API misuse.
  if (cyclic.length > 0) {
    return {
      graphId: graph.id,
      status: "rejected",
      issues: [
        ...issues,
        {
          severity: "error",
          code: "cycle",
          message: "Cyclic dependency detected; dry run aborted.",
        },
      ],
      order: [],
      results: [],
      summary: { total: graph.nodes.length, succeeded: 0, failed: 0, skipped: graph.nodes.length },
    }
  }

  const seed = options.seed ?? hashString(graph.id + graph.name)
  const rng = makeRng(seed)
  const results = new Map<string, NodeRunResult>()
  const outputs = new Map<string, unknown>()
  /** Taken output port per branch node, once it has run. */
  const takenPorts = new Map<string, string>()
  const triggerPayloads = options.triggerPayloads ?? {}

  let clock = 0

  for (const nodeId of order) {
    const node = getNode(graph, nodeId)
    if (!node) continue
    const def = getNodeType(node.type)

    // Determine which incoming edges are "active" for this node.
    const incoming = incomingEdges(graph, nodeId)
    const activeIncoming = incoming.filter((edge) => {
      const sourceResult = results.get(edge.sourceNodeId)
      if (!sourceResult || sourceResult.status !== "success") return false
      const sourceNode = getNode(graph, edge.sourceNodeId)
      if (sourceNode?.type === BRANCH_NODE_TYPE) {
        return takenPorts.get(edge.sourceNodeId) === edge.sourcePort
      }
      return true
    })

    const hasIncoming = incoming.length > 0
    const ranUpstreamFailed =
      hasIncoming &&
      incoming.some((edge) => {
        const r = results.get(edge.sourceNodeId)
        return r?.status === "error"
      })

    // A node with inputs runs only if at least one active edge feeds it, and
    // it is skipped when any connected upstream errored.
    const shouldRun = hasIncoming ? activeIncoming.length > 0 && !ranUpstreamFailed : true
    // Branch-taken check: if every incoming edge comes from a branch node via
    // an untaken port, activeIncoming is empty → skipped below.

    if (!shouldRun) {
      const skipped: NodeRunResult = {
        nodeId,
        status: "skipped",
        startedAtMs: clock,
        durationMs: 0,
        logs: hasIncoming
          ? ranUpstreamFailed
            ? ["Skipped: an upstream node failed."]
            : ["Skipped: no active input branch."]
          : ["Skipped."],
      }
      results.set(nodeId, skipped)
      continue
    }

    if (!def) {
      results.set(nodeId, {
        nodeId,
        status: "error",
        startedAtMs: clock,
        durationMs: 0,
        logs: [],
        error: `Unknown node type "${node.type}".`,
      })
      continue
    }

    const durationMs = Math.max(4, Math.round(4 + rng() * 40 + (hashString(nodeId) % 17)))
    const startedAtMs = clock
    clock += durationMs
    const logs: string[] = []

    // Gather inputs per port from active edges only.
    const inputs = new Map<string, unknown[]>()
    for (const port of def.inputs) {
      const values = activeIncoming
        .filter((edge) => edge.targetPort === port.id)
        .map((edge) => outputs.get(edge.sourceNodeId))
        .filter((value) => value !== undefined)
      if (values.length > 0) inputs.set(port.id, values)
    }

    const simulator = SIMULATORS[node.type]
    const ctx: SimContext = {
      node,
      graph,
      inputs,
      triggerPayloads,
      log: (message) => logs.push(message),
    }

    try {
      if (!simulator) throw new Error(`No dry-run simulator for node type "${node.type}".`)
      const { output } = simulator(ctx)
      outputs.set(nodeId, output)
      const inputSnapshot: Record<string, unknown> = {}
      for (const [portId, values] of ctx.inputs) {
        if (values.length > 0) inputSnapshot[portId] = values[0]
      }
      if (node.type === BRANCH_NODE_TYPE) {
        const branch =
          output && typeof output === "object" && "branch" in output
            ? String((output as { branch: unknown }).branch)
            : "true"
        takenPorts.set(nodeId, branch)
      }
      results.set(nodeId, {
        nodeId,
        status: "success",
        startedAtMs,
        durationMs,
        logs,
        output,
        inputs: inputSnapshot,
      })
    } catch (error) {
      results.set(nodeId, {
        nodeId,
        status: "error",
        startedAtMs,
        durationMs,
        logs,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const orderedResults = order
    .map((id) => results.get(id))
    .filter((r): r is NodeRunResult => Boolean(r))
  // Include any nodes missing from `order` defensively (shouldn't happen).
  for (const node of graph.nodes) {
    if (!results.has(node.id)) {
      orderedResults.push({
        nodeId: node.id,
        status: "skipped",
        startedAtMs: clock,
        durationMs: 0,
        logs: ["Skipped: not reachable in execution order."],
      })
    }
  }

  const succeeded = orderedResults.filter((r) => r.status === "success").length
  const failed = orderedResults.filter((r) => r.status === "error").length
  const skipped = orderedResults.filter((r) => r.status === "skipped").length

  return {
    graphId: graph.id,
    status: failed > 0 ? "error" : "success",
    issues,
    order,
    results: orderedResults,
    summary: { total: orderedResults.length, succeeded, failed, skipped },
  }
}

export { isTriggerType, getInputPort, getOutputPort }
