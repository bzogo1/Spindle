import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  getNodeType,
  topologicalSort,
  updateNode,
  type AutomationGraph,
  type GraphNode,
} from "@/lib/automation-graph"

import { humanizeCron } from "./cron"

/**
 * Bridge between the node-graph automation builder
 * (`src/components/automation-builder`) and the Studio dialog draft model used
 * by `AutomationsPanel`. The graph is the source of truth while editing; on
 * save it is flattened into the same `StudioDraft` shape the other modes
 * produce, so run history, the automations table, and `createdVia` keep
 * working unchanged.
 */

export type GraphStepKind = "trigger" | "condition" | "action"

export interface GraphDraftStep {
  id: string
  kind: GraphStepKind
  label: string
  detail?: string
}

/** Structurally identical to the panel's `StudioDraft` (mode is always "graph"). */
export interface GraphStudioDraft {
  name: string
  triggerKind: "schedule" | "event" | "webhook"
  triggerDetail: string
  triggerMeta?: string
  eventName?: string
  /** Endpoint URL for webhook triggers. */
  webhookUrl?: string
  actionKey: string
  actionLabel: string
  prompt: string
  steps: GraphDraftStep[]
  mode: "graph"
}

/** Node type → `ACTION_OPTIONS` value used by the form builder. */
const ACTION_KEY_BY_NODE_TYPE: Record<string, string> = {
  "action.post-summary": "post-summary",
  "action.update-files": "update-files",
  "action.webhook": "webhook",
  "agent.task": "agent-task",
}

const ACTION_LABEL_BY_KEY: Record<string, string> = {
  "post-summary": "Post run summary",
  "update-files": "Update project files",
  webhook: "Send webhook",
  "agent-task": "Run agent task",
}

let stepCounter = 0
function nextStepId(prefix: string) {
  stepCounter += 1
  return `graph_${prefix}_${stepCounter}`
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function actionKeyForNode(node: GraphNode): string | null {
  return ACTION_KEY_BY_NODE_TYPE[node.type] ?? null
}

function actionLabelForKey(key: string): string {
  return ACTION_LABEL_BY_KEY[key] ?? "Custom action"
}

/** Human-readable summary of a condition node's field/operator/value config. */
function conditionLabel(node: GraphNode): string {
  const field = str(node.config.field)
  const operator = str(node.config.operator)
  const value = str(node.config.value)
  if (!field && !operator && !value) return node.label
  const subject = field || "value"
  const comparison = operator ? ` ${operator}` : ""
  const operand = value ? ` "${value}"` : ""
  return `${subject}${comparison}${operand}`
}

/**
 * Flatten a validated automation graph into a studio draft.
 *
 * Returns `null` when the graph cannot be represented — no trigger node, no
 * mappable action node, or a schedule trigger without a valid cron expression.
 * Callers should gate on `isGraphValid` first; this function still defends
 * against structurally valid but semantically empty graphs.
 */
export function graphToStudioDraft(
  graph: AutomationGraph,
  options: { name: string; prompt: string },
): GraphStudioDraft | null {
  const { order } = topologicalSort(graph)
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))

  const triggerNode = order
    .map((id) => byId.get(id))
    .find((node) => node && getNodeType(node.type)?.category === "trigger")
  if (!triggerNode) return null

  let triggerKind: "schedule" | "event" | "webhook"
  let triggerDetail: string
  let triggerMeta: string | undefined
  let eventName: string | undefined
  let webhookUrl: string | undefined
  let triggerLabel: string
  let triggerDetailCode: string | undefined

  if (triggerNode.type === "trigger.schedule") {
    const cron = str(triggerNode.config.cron)
    const human = humanizeCron(cron)
    if (!cron || !human.valid) return null
    triggerKind = "schedule"
    triggerMeta = cron
    triggerDetail = human.text
    triggerLabel = human.text
    triggerDetailCode = cron
  } else if (triggerNode.type === "trigger.event") {
    const event = str(triggerNode.config.event)
    if (!event) return null
    triggerKind = "event"
    eventName = event
    triggerDetail = `On ${event}`
    triggerLabel = `When ${event} is emitted`
    triggerDetailCode = event
  } else if (triggerNode.type === "trigger.webhook") {
    const url = str(triggerNode.config.url)
    if (!url) return null
    triggerKind = "webhook"
    webhookUrl = url
    triggerDetail = `Webhook → ${url}`
    triggerLabel = "When a webhook delivery arrives"
    triggerDetailCode = url
  } else {
    // Unknown trigger type — cannot express it in the studio model.
    return null
  }

  const orderedNodes = order
    .map((id) => byId.get(id))
    .filter((node): node is GraphNode => Boolean(node) && node!.id !== triggerNode.id)

  // First mappable action node (in execution order) supplies actionKey/label.
  let actionKey: string | null = null
  for (const node of orderedNodes) {
    if (getNodeType(node.type)?.category !== "action") continue
    const key = actionKeyForNode(node)
    if (key) {
      actionKey = key
      break
    }
  }
  if (!actionKey) return null

  const steps: GraphDraftStep[] = [
    {
      id: nextStepId("trigger"),
      kind: "trigger",
      label: triggerLabel,
      detail: triggerDetailCode,
    },
  ]

  for (const node of orderedNodes) {
    const category = getNodeType(node.type)?.category
    if (category === "trigger") {
      // Extra triggers can't be expressed; surface them as steps anyway.
      steps.push({
        id: nextStepId("trigger_extra"),
        kind: "trigger",
        label: node.label,
      })
      continue
    }
    if (category === "logic" || node.type === "condition") {
      steps.push({
        id: nextStepId("condition"),
        kind: "condition",
        label: conditionLabel(node),
      })
      continue
    }
    const key = actionKeyForNode(node)
    steps.push({
      id: nextStepId("action"),
      kind: "action",
      label: key ? actionLabelForKey(key) : node.label,
    })
  }

  return {
    name: options.name.trim(),
    triggerKind,
    triggerDetail,
    triggerMeta,
    eventName,
    webhookUrl,
    actionKey,
    actionLabel: actionLabelForKey(actionKey),
    prompt: options.prompt.trim(),
    steps,
    mode: "graph",
  }
}

/**
 * A minimal valid graph used to seed the Graph tab: one trigger wired to one
 * agent task. `triggerMeta` is the cron expression for schedule triggers, the
 * endpoint URL for webhook triggers, and ignored for event triggers.
 */
export function starterAutomationGraph(
  name: string,
  triggerKind: "schedule" | "event" | "webhook" = "schedule",
  triggerMeta = "0 9 * * *",
): AutomationGraph {
  let graph = createEmptyGraph(name)
  const triggerType =
    triggerKind === "event"
      ? "trigger.event"
      : triggerKind === "webhook"
        ? "trigger.webhook"
        : "trigger.schedule"
  graph = addNodeToGraph(graph, triggerType, { x: 40, y: 120 })
  const triggerId = graph.nodes[graph.nodes.length - 1].id
  graph = addNodeToGraph(graph, "agent.task", { x: 360, y: 120 })
  const actionId = graph.nodes[graph.nodes.length - 1].id

  graph = updateNode(graph, triggerId, {
    config:
      triggerKind === "event"
        ? { event: "file.uploaded", payload: "" }
        : triggerKind === "webhook"
          ? { url: triggerMeta, secret: "", events: "", payload: "" }
          : { cron: triggerMeta || "0 9 * * *", payload: "" },
  })
  // agent.task requires a prompt; seed it from the automation name.
  graph = updateNode(graph, actionId, {
    config: { prompt: name ? `Handle: ${name}` : "", simulateError: false },
  })

  graph = addEdgeToGraph(graph, {
    sourceNodeId: triggerId,
    sourcePort: "out",
    targetNodeId: actionId,
    targetPort: "in",
  })
  return graph
}
