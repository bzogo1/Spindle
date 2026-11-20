import { addEdgeToGraph, addNodeToGraph, createEmptyGraph, updateNode } from "./graph"
import type { AutomationGraph, GraphNode, NodePosition } from "./types"

/**
 * Starter templates for the automation builder. Each template is a small,
 * valid graph built from registry node types; `build()` returns a fresh graph
 * (new ids) every call so loading a template never shares mutable state with
 * a previous load.
 */
export interface AutomationTemplate {
  /** Stable slug, e.g. "daily-digest". */
  id: string
  /** Display name; also used as the graph name. */
  name: string
  description: string
  build: () => AutomationGraph
}

interface PlacedNode {
  graph: AutomationGraph
  node: GraphNode
}

/** Append a node with default config merged with `config`, returning both. */
function place(
  graph: AutomationGraph,
  type: string,
  position: NodePosition,
  config?: Record<string, unknown>,
): PlacedNode {
  const next = addNodeToGraph(graph, type, position)
  const node = next.nodes[next.nodes.length - 1]
  const patched = updateNode(next, node.id, {
    ...(config ? { config: { ...node.config, ...config } } : {}),
  })
  return { graph: patched, node: patched.nodes[patched.nodes.length - 1] }
}

function connect(
  graph: AutomationGraph,
  source: GraphNode,
  sourcePort: string,
  target: GraphNode,
  targetPort: string,
): AutomationGraph {
  return addEdgeToGraph(graph, {
    sourceNodeId: source.id,
    sourcePort,
    targetNodeId: target.id,
    targetPort,
  })
}

function buildDailyDigest(): AutomationGraph {
  let graph = createEmptyGraph("Daily digest")
  const trigger = place(
    graph,
    "trigger.schedule",
    { x: 60, y: 140 },
    {
      cron: "0 9 * * *",
      payload: '{"source": "daily-digest"}',
    },
  )
  graph = trigger.graph
  const agent = place(
    graph,
    "agent.task",
    { x: 380, y: 60 },
    {
      prompt: "Review what changed since the last run and draft a concise digest for the team.",
    },
  )
  graph = agent.graph
  const summary = place(
    graph,
    "action.post-summary",
    { x: 700, y: 140 },
    {
      channel: "#project-updates",
    },
  )
  graph = summary.graph
  graph = connect(graph, trigger.node, "out", agent.node, "in")
  graph = connect(graph, agent.node, "out", summary.node, "in")
  return graph
}

function buildFileChangeAlert(): AutomationGraph {
  let graph = createEmptyGraph("File change alert")
  const trigger = place(
    graph,
    "trigger.event",
    { x: 60, y: 140 },
    {
      event: "file.uploaded",
      payload: '{"file": "survey-export.csv"}',
    },
  )
  graph = trigger.graph
  const check = place(
    graph,
    "condition",
    { x: 380, y: 140 },
    {
      field: "file",
      operator: "truthy",
    },
  )
  graph = check.graph
  const notify = place(
    graph,
    "action.post-summary",
    { x: 700, y: 60 },
    {
      channel: "#project-updates",
    },
  )
  graph = notify.graph
  graph = connect(graph, trigger.node, "out", check.node, "in")
  graph = connect(graph, check.node, "true", notify.node, "in")
  return graph
}

function buildWeeklyIndexRefresh(): AutomationGraph {
  let graph = createEmptyGraph("Weekly index refresh")
  const trigger = place(
    graph,
    "trigger.schedule",
    { x: 60, y: 140 },
    {
      cron: "0 17 * * 5",
      payload: '{"source": "weekly-index-refresh"}',
    },
  )
  graph = trigger.graph
  const agent = place(
    graph,
    "agent.task",
    { x: 380, y: 60 },
    {
      prompt: "Review the past week's changes and produce an updated project index.",
    },
  )
  graph = agent.graph
  const write = place(
    graph,
    "action.update-files",
    { x: 700, y: 140 },
    {
      target: "results/index.json",
    },
  )
  graph = write.graph
  graph = connect(graph, trigger.node, "out", agent.node, "in")
  graph = connect(graph, agent.node, "out", write.node, "in")
  return graph
}

function buildEventTriage(): AutomationGraph {
  let graph = createEmptyGraph("Event triage")
  const trigger = place(
    graph,
    "trigger.event",
    { x: 60, y: 200 },
    {
      event: "pipeline.completed",
      payload: '{"status": "failed", "pipeline": "ingest"}',
    },
  )
  graph = trigger.graph
  const check = place(
    graph,
    "condition",
    { x: 380, y: 200 },
    {
      field: "status",
      operator: "equals",
      value: "failed",
    },
  )
  graph = check.graph
  const investigate = place(
    graph,
    "agent.task",
    { x: 700, y: 60 },
    {
      prompt: "Investigate the failure and summarize what went wrong.",
    },
  )
  graph = investigate.graph
  const summary = place(
    graph,
    "action.post-summary",
    { x: 700, y: 320 },
    {
      channel: "#project-updates",
    },
  )
  graph = summary.graph
  graph = connect(graph, trigger.node, "out", check.node, "in")
  graph = connect(graph, check.node, "true", investigate.node, "in")
  graph = connect(graph, check.node, "false", summary.node, "in")
  return graph
}

function buildCsvCleanup(): AutomationGraph {
  let graph = createEmptyGraph("CSV cleanup")
  const trigger = place(
    graph,
    "trigger.schedule",
    { x: 60, y: 140 },
    {
      cron: "30 6 * * *",
      payload: '{"source": "csv-cleanup"}',
    },
  )
  graph = trigger.graph
  const normalize = place(
    graph,
    "transform",
    { x: 380, y: 140 },
    {
      operation: "template",
      template: "cleaned: {{input}}",
    },
  )
  graph = normalize.graph
  const log = place(
    graph,
    "action.log",
    { x: 700, y: 60 },
    {
      level: "info",
      message: "CSV cleanup pass completed",
    },
  )
  graph = log.graph
  const write = place(
    graph,
    "action.update-files",
    { x: 700, y: 240 },
    {
      target: "results/cleaned.csv",
    },
  )
  graph = write.graph
  graph = connect(graph, trigger.node, "out", normalize.node, "in")
  graph = connect(graph, normalize.node, "out", log.node, "in")
  graph = connect(graph, normalize.node, "out", write.node, "in")
  return graph
}

function buildErrorAlert(): AutomationGraph {
  let graph = createEmptyGraph("Error alert")
  const trigger = place(
    graph,
    "trigger.event",
    { x: 60, y: 140 },
    {
      event: "pipeline.failed",
      payload: '{"pipeline": "ingest", "status": "failed"}',
    },
  )
  graph = trigger.graph
  const check = place(
    graph,
    "condition",
    { x: 380, y: 140 },
    {
      field: "status",
      operator: "equals",
      value: "failed",
    },
  )
  graph = check.graph
  const log = place(
    graph,
    "action.log",
    { x: 700, y: 60 },
    {
      level: "error",
      message: "Pipeline failure detected",
    },
  )
  graph = log.graph
  const notify = place(
    graph,
    "action.post-summary",
    { x: 700, y: 240 },
    {
      channel: "#incidents",
    },
  )
  graph = notify.graph
  graph = connect(graph, trigger.node, "out", check.node, "in")
  graph = connect(graph, check.node, "true", log.node, "in")
  graph = connect(graph, check.node, "true", notify.node, "in")
  return graph
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: "daily-digest",
    name: "Daily digest",
    description:
      "Every morning, an agent reviews recent changes and posts a digest to the workspace.",
    build: buildDailyDigest,
  },
  {
    id: "file-change-alert",
    name: "File change alert",
    description: "When a file is uploaded, verify the payload and post a notification.",
    build: buildFileChangeAlert,
  },
  {
    id: "weekly-index-refresh",
    name: "Weekly index refresh",
    description:
      "Every Friday, an agent reviews the week's changes and rewrites the project index.",
    build: buildWeeklyIndexRefresh,
  },
  {
    id: "event-triage",
    name: "Event triage",
    description:
      "Route events by status: failures go to an agent for investigation, everything else gets a summary post.",
    build: buildEventTriage,
  },
  {
    id: "csv-cleanup",
    name: "CSV cleanup",
    description:
      "Every morning, normalize the latest CSV export, log the pass, and write the cleaned output back to the project.",
    build: buildCsvCleanup,
  },
  {
    id: "error-alert",
    name: "Error alert",
    description:
      "When a pipeline fails, log an error entry and post an alert to the incidents channel.",
    build: buildErrorAlert,
  },
]
