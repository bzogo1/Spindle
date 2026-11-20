import { describe, expect, it } from "vitest"

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  isGraphValid,
  updateNode,
} from "@/lib/automation-graph"

import { graphToStudioDraft, starterAutomationGraph } from "./graph-draft"

function connect(graph: ReturnType<typeof createEmptyGraph>, source: number, target: number) {
  return addEdgeToGraph(graph, {
    sourceNodeId: graph.nodes[source].id,
    sourcePort: "out",
    targetNodeId: graph.nodes[target].id,
    targetPort: "in",
  })
}

describe("graphToStudioDraft", () => {
  it("converts a schedule-trigger starter graph into a studio draft", () => {
    const graph = starterAutomationGraph("Daily digest", "schedule", "0 9 * * *")
    expect(isGraphValid(graph)).toBe(true)

    const draft = graphToStudioDraft(graph, { name: "Daily digest", prompt: "Do the thing." })

    expect(draft).not.toBeNull()
    expect(draft!.mode).toBe("graph")
    expect(draft!.name).toBe("Daily digest")
    expect(draft!.prompt).toBe("Do the thing.")
    expect(draft!.triggerKind).toBe("schedule")
    expect(draft!.triggerMeta).toBe("0 9 * * *")
    expect(draft!.triggerDetail).toMatch(/09:00 AM/)
    expect(draft!.eventName).toBeUndefined()
    expect(draft!.actionKey).toBe("agent-task")
    expect(draft!.actionLabel).toBe("Run agent task")
    expect(draft!.steps[0]).toMatchObject({ kind: "trigger" })
    expect(draft!.steps.some((step) => step.kind === "action")).toBe(true)
  })

  it("converts an event trigger into an event draft", () => {
    const graph = starterAutomationGraph("Upload watcher", "event")
    const draft = graphToStudioDraft(graph, { name: "Upload watcher", prompt: "React." })

    expect(draft).not.toBeNull()
    expect(draft!.triggerKind).toBe("event")
    expect(draft!.eventName).toBe("file.uploaded")
    expect(draft!.triggerDetail).toBe("On file.uploaded")
    expect(draft!.triggerMeta).toBeUndefined()
  })

  it("maps condition nodes to condition steps and actions in execution order", () => {
    let graph = createEmptyGraph("Conditional")
    graph = addNodeToGraph(graph, "trigger.schedule", { x: 0, y: 0 })
    graph = updateNode(graph, graph.nodes[0].id, { config: { cron: "0 8 * * 1", payload: "" } })
    graph = addNodeToGraph(graph, "condition", { x: 200, y: 0 })
    graph = updateNode(graph, graph.nodes[1].id, {
      config: { field: "status", operator: "equals", value: "ok" },
    })
    graph = addNodeToGraph(graph, "action.post-summary", { x: 400, y: 0 })
    graph = addNodeToGraph(graph, "agent.task", { x: 600, y: 0 })
    graph = connect(graph, 0, 1)
    // Route the true branch to the summary, the false branch to the agent task.
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[1].id,
      sourcePort: "true",
      targetNodeId: graph.nodes[2].id,
      targetPort: "in",
    })
    graph = addEdgeToGraph(graph, {
      sourceNodeId: graph.nodes[1].id,
      sourcePort: "false",
      targetNodeId: graph.nodes[3].id,
      targetPort: "in",
    })

    const draft = graphToStudioDraft(graph, { name: "Conditional", prompt: "Run." })

    expect(draft).not.toBeNull()
    expect(draft!.steps.map((step) => step.kind)).toEqual([
      "trigger",
      "condition",
      "action",
      "action",
    ])
    expect(draft!.steps[1].label).toContain("status")
    expect(draft!.steps[1].label).toContain("equals")
    // First mappable action in topo order wins for actionKey.
    expect(draft!.actionKey).toBe("post-summary")
    expect(draft!.actionLabel).toBe("Post run summary")
  })

  it("returns null for graphs that cannot become a draft", () => {
    // Empty graph: valid structurally, but no trigger/action.
    expect(graphToStudioDraft(createEmptyGraph("Empty"), { name: "x", prompt: "y" })).toBeNull()

    // Trigger only, no action.
    let triggerOnly = addNodeToGraph(createEmptyGraph("T"), "trigger.schedule", { x: 0, y: 0 })
    expect(graphToStudioDraft(triggerOnly, { name: "x", prompt: "y" })).toBeNull()

    // Invalid cron on the schedule trigger.
    triggerOnly = updateNode(triggerOnly, triggerOnly.nodes[0].id, {
      config: { cron: "not a cron", payload: "" },
    })
    triggerOnly = addNodeToGraph(triggerOnly, "agent.task", { x: 200, y: 0 })
    triggerOnly = connect(triggerOnly, 0, 1)
    expect(graphToStudioDraft(triggerOnly, { name: "x", prompt: "y" })).toBeNull()
  })

  it("converts a webhook trigger into a webhook draft", () => {
    const graph = starterAutomationGraph(
      "Deploy hook",
      "webhook",
      "https://api.example.com/hooks/deploy",
    )
    expect(isGraphValid(graph)).toBe(true)

    const draft = graphToStudioDraft(graph, { name: "Deploy hook", prompt: "React." })

    expect(draft).not.toBeNull()
    expect(draft!.triggerKind).toBe("webhook")
    expect(draft!.webhookUrl).toBe("https://api.example.com/hooks/deploy")
    expect(draft!.triggerDetail).toBe("Webhook → https://api.example.com/hooks/deploy")
    expect(draft!.eventName).toBeUndefined()
    expect(draft!.triggerMeta).toBeUndefined()
  })

  it("maps action.webhook nodes to the webhook action key", () => {
    let graph = starterAutomationGraph("Hook relay", "webhook", "https://in.example.com/hook")
    // Replace the seeded agent.task with an outbound webhook action.
    graph = { ...graph, nodes: graph.nodes.slice(0, 1), edges: [] }
    graph = addNodeToGraph(graph, "action.webhook", { x: 360, y: 120 })
    graph = updateNode(graph, graph.nodes[1].id, {
      config: {
        url: "https://out.example.com/notify",
        method: "POST",
        secret: "",
        simulateError: false,
      },
    })
    graph = connect(graph, 0, 1)

    const draft = graphToStudioDraft(graph, { name: "Hook relay", prompt: "" })

    expect(draft).not.toBeNull()
    expect(draft!.actionKey).toBe("webhook")
    expect(draft!.actionLabel).toBe("Send webhook")
  })

  it("starterAutomationGraph always produces a valid, convertible graph", () => {
    for (const kind of ["schedule", "event", "webhook"] as const) {
      const graph = starterAutomationGraph("Seed", kind)
      expect(isGraphValid(graph)).toBe(true)
      expect(graphToStudioDraft(graph, { name: "Seed", prompt: "p" })).not.toBeNull()
    }
  })
})
