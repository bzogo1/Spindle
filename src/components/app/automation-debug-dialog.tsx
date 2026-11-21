"use client"

import { useMemo } from "react"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  getNodeType,
  updateNode,
  type AutomationGraph,
} from "@/lib/automation-graph"
import { DebuggerPanel } from "@/components/automation-builder"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * "Debug" dialog for workspace automations. The panel stores automations as a
 * flattened step list, so this rebuilds an equivalent node graph and hands it
 * to the builder's step-through `DebuggerPanel` for variable inspection.
 */

export interface DebuggableAutomation {
  id: string
  name: string
  prompt: string
  trigger: {
    kind: "schedule" | "event" | "webhook"
    detail: string
    meta?: string
  }
  actionKey?: string
  steps?: {
    id: string
    kind: "trigger" | "condition" | "action"
    label: string
    detail?: string
  }[]
}

/** Action-step labels produced by the studio draft model → node types. */
const ACTION_TYPE_BY_LABEL: Record<string, string> = {
  "Post run summary": "action.post-summary",
  "Update project files": "action.update-files",
  "Send webhook": "action.webhook",
  "Run agent task": "agent.task",
}

/** Studio action keys → node types for steps with custom labels. */
const ACTION_TYPE_BY_KEY: Record<string, string> = {
  "post-summary": "action.post-summary",
  "update-files": "action.update-files",
  webhook: "action.webhook",
  "agent-task": "agent.task",
}

function triggerNodeSpec(automation: DebuggableAutomation): {
  type: string
  config: Record<string, unknown>
  label: string
} {
  const meta = automation.trigger.meta?.trim() ?? ""
  if (automation.trigger.kind === "event") {
    // Builder drafts store "On file.uploaded" in detail; mocks store the bare name.
    const raw = automation.trigger.detail.trim()
    const event = raw.startsWith("On ") ? raw.slice(3).trim() : raw
    return {
      type: "trigger.event",
      config: { event: event || "file.uploaded", payload: "" },
      label: automation.trigger.detail || "When event is emitted",
    }
  }
  if (automation.trigger.kind === "webhook") {
    return {
      type: "trigger.webhook",
      config: { url: meta || "https://example.com/automation-hook", payload: "" },
      label: "When a webhook delivery arrives",
    }
  }
  return {
    type: "trigger.schedule",
    config: { cron: meta || "0 9 * * *", payload: "" },
    label: automation.trigger.detail || "On a schedule",
  }
}

function configForNode(
  type: string,
  stepLabel: string,
  automation: DebuggableAutomation,
): Record<string, unknown> {
  switch (type) {
    case "agent.task":
      return {
        prompt: automation.prompt.trim() || stepLabel || "Handle the incoming payload.",
        simulateError: false,
      }
    case "action.webhook":
      return {
        url: "https://example.com/automation-hook",
        method: "POST",
        secret: "",
        simulateError: false,
      }
    case "action.log":
      return {
        level: "info",
        message: stepLabel || "Automation step completed",
        simulateError: false,
      }
    case "action.post-summary":
      return { channel: "#project-updates", simulateError: false }
    case "action.update-files":
      return { target: "results/summary.json", simulateError: false }
    default:
      return {}
  }
}

function actionNodeType(stepLabel: string, isFirstAction: boolean, actionKey?: string): string {
  const byLabel = ACTION_TYPE_BY_LABEL[stepLabel]
  if (byLabel) return byLabel
  if (isFirstAction) return ACTION_TYPE_BY_KEY[actionKey ?? ""] ?? "agent.task"
  // Custom secondary steps degrade to a log entry so the graph stays valid.
  return "action.log"
}

/**
 * Rebuild an `AutomationGraph` from the flattened automation record. Falls
 * back to a minimal trigger → agent-task graph when no steps were stored.
 */
export function graphForAutomation(automation: DebuggableAutomation): AutomationGraph {
  let graph = createEmptyGraph(automation.name)

  const steps = automation.steps ?? []
  const triggerStep = steps.find((step) => step.kind === "trigger")
  const triggerSpec = triggerNodeSpec(automation)

  if (!triggerStep) {
    // No recorded steps — seed a minimal runnable graph from the trigger.
    graph = addNodeToGraph(graph, triggerSpec.type, { x: 40, y: 120 })
    const triggerId = graph.nodes[graph.nodes.length - 1].id
    graph = updateNode(graph, triggerId, {
      label: triggerSpec.label,
      config: { ...(getNodeType(triggerSpec.type)?.defaultConfig ?? {}), ...triggerSpec.config },
    })
    graph = addNodeToGraph(graph, "agent.task", { x: 360, y: 120 })
    const actionId = graph.nodes[graph.nodes.length - 1].id
    graph = updateNode(graph, actionId, {
      config: {
        ...(getNodeType("agent.task")?.defaultConfig ?? {}),
        ...configForNode("agent.task", automation.name, automation),
      },
    })
    try {
      graph = addEdgeToGraph(graph, {
        sourceNodeId: triggerId,
        sourcePort: "out",
        targetNodeId: actionId,
        targetPort: "in",
      })
    } catch {
      // Dry run still works on unconnected graphs.
    }
    return graph
  }

  const ordered = [
    triggerStep,
    ...steps.filter((step) => step.id !== triggerStep.id && step.kind !== "trigger"),
  ]

  let previous: { id: string; type: string } | null = null
  let sawAction = false

  ordered.forEach((step, index) => {
    const isTrigger = step.kind === "trigger"
    const type = isTrigger
      ? triggerSpec.type
      : step.kind === "condition"
        ? "condition"
        : actionNodeType(step.label, !sawAction, automation.actionKey)
    if (step.kind === "action") sawAction = true

    const position = { x: 40 + index * 280, y: isTrigger ? 120 : 200 }
    graph = addNodeToGraph(graph, type, position)
    const nodeId = graph.nodes[graph.nodes.length - 1].id

    const def = getNodeType(type)
    const label = isTrigger
      ? step.label || triggerSpec.label
      : step.label || def?.label || type
    const config = isTrigger
      ? triggerSpec.config
      : configForNode(type, step.label, automation)
    graph = updateNode(graph, nodeId, {
      label,
      config: { ...(def?.defaultConfig ?? {}), ...config },
    })

    const hasInput = def?.inputs.some((port) => port.id === "in") ?? false
    if (previous && hasInput) {
      const prevDef = getNodeType(previous.type)
      const sourcePort =
        previous.type === "condition" ? "true" : (prevDef?.outputs[0]?.id ?? "out")
      try {
        graph = addEdgeToGraph(graph, {
          sourceNodeId: previous.id,
          sourcePort,
          targetNodeId: nodeId,
          targetPort: "in",
        })
      } catch {
        // Skip unconnectable pairs rather than failing the whole dialog.
      }
    }

    previous = { id: nodeId, type }
  })

  return graph
}

export function AutomationDebugDialog({
  automation,
  open,
  onOpenChange,
}: {
  automation: DebuggableAutomation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const graph = useMemo(() => (automation ? graphForAutomation(automation) : null), [automation])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Debug {automation?.name ?? "automation"}</DialogTitle>
          <DialogDescription>
            Step through a simulated run of this automation, inspecting payloads and variables at
            each node. Breakpoints are set by clicking a step&apos;s dot.
          </DialogDescription>
        </DialogHeader>
        {graph ? (
          <DebuggerPanel graph={graph} />
        ) : (
          <p className="text-muted-foreground text-sm">Select an automation to debug.</p>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
