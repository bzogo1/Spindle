/**
 * Natural-language intent parsing and builder helpers for the automations
 * studio. The Ask AI mode uses `parseAutomationIntent` to turn a plain-English
 * request into a concrete trigger/action draft; there is no backend model yet,
 * so this is a deterministic heuristic port of the marketing-page parser in
 * `src/lib/interactions/automations.js`.
 */

import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraph,
  updateNode,
} from "@/lib/automation-graph/graph"
import type { AutomationGraph, GraphNode } from "@/lib/automation-graph/types"

import { humanizeCron } from "./cron"

export type AutomationTriggerKind = "schedule" | "event"

export interface ParsedIntent {
  title: string
  triggerKind: AutomationTriggerKind
  /** Five-field cron expression when triggerKind is "schedule". */
  cron?: string
  /** Event name when triggerKind is "event". */
  eventName?: string
  /** Human-readable trigger summary, e.g. "Every day · 05:00 PM". */
  triggerLabel: string
  /** Ordered plain-language steps the automation will perform. */
  steps: string[]
  /** Key into the action catalog used for the list's action column. */
  actionKey: "update-files" | "post-summary" | "agent-task"
  /** Suggested instructions stored on the automation prompt. */
  prompt: string
  /** Where the outcome should be delivered (channel name, file, or digest label). */
  destination: string
}

const DAY_WORDS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function clockLabel(hour: number, minute: number) {
  const suffix = hour >= 12 ? "PM" : "AM"
  const hour12 = hour % 12 || 12
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`
}

function listAnd(items: string[]) {
  if (items.length <= 1) return items[0] ?? ""
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1]
}

/** Parse a free-text automation request into a concrete draft config. */
export function parseAutomationIntent(text: string): ParsedIntent {
  const lower = text.toLowerCase().trim()

  let hour = 17
  let minute = 0
  const time12 = lower.match(/\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*(am|pm)\b/)
  const time24 = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (time12) {
    hour = (parseInt(time12[1], 10) % 12) + (time12[3] === "pm" ? 12 : 0)
    minute = parseInt(time12[2] || "0", 10)
  } else if (time24) {
    hour = parseInt(time24[1], 10)
    minute = parseInt(time24[2], 10)
  }

  let frequency: "daily" | "weekly" | "file" = "daily"
  let weekday = 1
  const weekdayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)
  if (
    /\bevery (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower) ||
    /\bweekly\b|\bevery week\b/.test(lower)
  ) {
    frequency = "weekly"
    if (weekdayMatch) {
      const idx = DAY_INDEX[weekdayMatch[1]]
      if (idx !== undefined) weekday = idx
    }
  } else if (
    /\bwhen (a|the|new)|new (csv|file|upload|source)|lands? in|on upload|whenever a\b/.test(lower)
  ) {
    frequency = "file"
  }

  let subject = "results"
  if (/\bpaper|article|arxiv|source|literature\b/.test(lower)) subject = "papers"
  else if (/\bcsv|dataset|file|upload|data folder|\/data\b/.test(lower)) subject = "files"
  else if (/\btide|sensor|sample\b/.test(lower)) subject = "samples"

  const wantsFlag =
    /\bflag|outlier|weird|wrong|anomal|sanity[- ]check|check (for|if|whether)\b/.test(lower)
  const wantsSummary = /\bsummar|digest|recap|write a note\b/.test(lower)
  const wantsClean = /\bclean|normaliz|format|tidy\b/.test(lower)

  let destination = "#study-updates"
  if (/notes\.md|project log|\blog\b/.test(lower)) destination = "notes.md"
  else if (/\bemail\b/.test(lower)) destination = "email digest"
  else if (/#[a-z-]+/.test(lower)) destination = lower.match(/#[a-z-]+/)?.[0] ?? destination

  const steps: string[] = []
  if (frequency === "file") {
    steps.push("Watch the project folder for a new " + (subject === "files" ? "CSV" : "file"))
  } else {
    steps.push("Collect new " + subject + " since the last run")
  }
  if (wantsClean) steps.push("Clean and normalize the incoming entries")
  if (wantsFlag)
    steps.push(
      subject === "papers"
        ? "Pick out the most relevant new papers"
        : "Compare with the baseline and flag outliers",
    )
  if (wantsSummary)
    steps.push(
      subject === "papers" ? "Write a short summary into notes.md" : "Write a two-paragraph digest",
    )
  if (steps.length < 2) steps.push("Summarize what changed since the last run")
  steps.push("Send the outcome to " + destination)

  let title = "Daily " + subject + " check"
  if (frequency === "weekly") title = "Weekly " + subject + " digest"
  if (frequency === "file") {
    const singulars: Record<string, string> = {
      results: "result",
      papers: "paper",
      files: "file",
      samples: "sample",
    }
    title = "New " + (singulars[subject] ?? subject) + " workflow"
  }
  if (wantsSummary && subject === "papers" && frequency === "weekly") title = "Weekly paper summary"

  const timeLabel = clockLabel(hour, minute)
  let triggerLabel = "Every day · " + timeLabel
  let cron: string | undefined
  let eventName: string | undefined
  let triggerKind: AutomationTriggerKind = "schedule"

  if (frequency === "weekly") {
    triggerLabel = "Every " + DAY_WORDS[weekday] + " · " + timeLabel
    cron = `${minute} ${hour} * * ${weekday}`
  } else if (frequency === "file") {
    triggerKind = "event"
    eventName = "file.uploaded"
    triggerLabel = "Whenever a new file lands in the project folder"
  } else {
    cron = `${minute} ${hour} * * *`
  }

  const actionKey: ParsedIntent["actionKey"] =
    frequency === "file"
      ? "update-files"
      : wantsSummary
        ? "post-summary"
        : wantsFlag || wantsClean
          ? "agent-task"
          : "post-summary"

  return {
    title,
    triggerKind,
    cron,
    eventName,
    triggerLabel,
    steps,
    actionKey,
    prompt: text.trim(),
    destination,
  }
}

export type BuilderFrequency = "daily" | "weekly"

/** Build a five-field cron expression from friendly builder controls. */
export function cronForBuilderSchedule(
  frequency: BuilderFrequency,
  time: string,
  days: number[],
): string | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(time.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23) return null

  if (frequency === "daily") return `${minute} ${hour} * * *`

  const unique = Array.from(new Set(days.filter((d) => d >= 0 && d <= 6))).sort((a, b) => a - b)
  if (!unique.length) return null
  return `${minute} ${hour} * * ${unique.join(",")}`
}

/** Human-readable trigger label for a builder configuration. */
export function builderTriggerLabel(input: {
  triggerKind: AutomationTriggerKind
  frequency: BuilderFrequency
  time: string
  days: number[]
  eventName: string
}): string {
  if (input.triggerKind === "event") {
    return input.eventName.trim() ? `On ${input.eventName.trim()}` : "On project event"
  }

  const [hourStr, minuteStr] = input.time.split(":")
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  const timeLabel =
    Number.isFinite(hour) && Number.isFinite(minute) ? clockLabel(hour, minute) : input.time

  if (input.frequency === "weekly") {
    const names = input.days
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b)
      .map((d) => DAY_WORDS[d])
    return names.length ? `Every ${listAnd(names)} · ${timeLabel}` : `Weekly · ${timeLabel}`
  }
  return `Every day · ${timeLabel}`
}

/** Validate a cron expression and return its human description when valid. */
export function describeCron(expr: string): { valid: boolean; text: string; parts?: string[] } {
  return humanizeCron(expr)
}

export interface BuilderScheduleState {
  frequency: BuilderFrequency
  time: string
  days: number[]
}

/**
 * Best-effort reverse mapping from a cron expression to builder controls.
 * Returns null for schedules the simple builder cannot express (dom/month
 * restrictions, steps, ranges).
 */
export function builderStateFromCron(expr: string): BuilderScheduleState | null {
  const human = humanizeCron(expr)
  if (!human.valid || !human.parts) return null
  const [min, hour, dom, , dow] = human.parts
  if (dom !== "*" || human.parts[3] !== "*") return null

  const minute = Number(min)
  const hourNum = Number(hour)
  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hourNum) ||
    min.includes("/") ||
    hour.includes("/")
  )
    return null

  const time = `${String(hourNum).padStart(2, "0")}:${String(minute).padStart(2, "0")}`

  if (dow === "*") return { frequency: "daily", time, days: [1] }

  const days = dow
    .split(",")
    .map((d) => {
      const n = Number(d)
      return n === 7 ? 0 : n
    })
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const unique = Array.from(new Set(days)).sort((a, b) => a - b)
  if (!unique.length || unique.length !== dow.split(",").length) return null

  return { frequency: "weekly", time, days: unique }
}

/* ------------------------------------------------------------------------ */
/* Intent → graph assist                                                     */
/* ------------------------------------------------------------------------ */

export interface IntentGraphResult {
  graph: AutomationGraph
  intent: ParsedIntent
  /** Human-readable notes about the choices the builder made. */
  notes: string[]
}

/**
 * Turn a natural-language automation request into a concrete, connected
 * automation graph. Rule-based: reuses `parseAutomationIntent` for trigger and
 * destination extraction, then keyword-matches the request for optional
 * transform/condition/agent/action nodes and wires them in execution order.
 *
 * The result is a valid graph (every required config field is filled), ready
 * to drop onto the builder canvas.
 */
export function buildGraphFromIntent(text: string): IntentGraphResult {
  const intent = parseAutomationIntent(text)
  const lower = text.toLowerCase()
  const wantsClean = /\bclean|normaliz|format|tidy\b/.test(lower)
  const wantsFlag =
    /\bflag|outlier|weird|wrong|anomal|sanity[- ]check|check (for|if|whether)\b/.test(lower)
  const notes: string[] = []

  let graph = createEmptyGraph(intent.title)

  // Trigger node with the parsed schedule/event config filled in.
  const triggerType = intent.triggerKind === "event" ? "trigger.event" : "trigger.schedule"
  graph = addNodeToGraph(graph, triggerType, { x: 60, y: 140 })
  const trigger = graph.nodes[graph.nodes.length - 1]
  graph = updateNode(graph, trigger.id, {
    config:
      triggerType === "trigger.event"
        ? { event: intent.eventName ?? "file.uploaded", payload: "" }
        : { cron: intent.cron ?? "0 9 * * *", payload: "" },
  })

  const channel = /^#/.test(intent.destination) ? intent.destination : "#project-updates"
  if (channel !== intent.destination) {
    notes.push(
      `Destination "${intent.destination}" is not a channel; notifications go to ${channel}.`,
    )
  }

  let x = 380
  const place = (type: string, config?: Record<string, unknown>): GraphNode => {
    graph = addNodeToGraph(graph, type, { x, y: 140 })
    const node = graph.nodes[graph.nodes.length - 1]
    if (config) {
      graph = updateNode(graph, node.id, { config: { ...node.config, ...config } })
    }
    x += 320
    return graph.nodes[graph.nodes.length - 1]
  }
  const connect = (
    source: GraphNode,
    sourcePort: string,
    target: GraphNode,
    targetPort: string,
  ) => {
    graph = addEdgeToGraph(graph, {
      sourceNodeId: source.id,
      sourcePort,
      targetNodeId: target.id,
      targetPort,
    })
  }

  let previous = trigger
  let previousPort = "out"
  let falseBranch: { node: GraphNode; port: string } | null = null

  if (wantsClean) {
    const transform = place("transform", {
      operation: "template",
      template: "normalized: {{input}}",
    })
    connect(previous, previousPort, transform, "in")
    previous = transform
    previousPort = "out"
    notes.push("Added a transform step to clean/normalize the payload.")
  }

  if (wantsFlag) {
    const condition = place("condition", {
      field: "",
      operator: "truthy",
    })
    connect(previous, previousPort, condition, "in")
    previous = condition
    previousPort = "true"
    falseBranch = { node: condition, port: "false" }
    notes.push("Added a condition gate; flagged runs continue, others short-circuit.")
  }

  // The agent step carries the user's intent as its prompt. File-update
  // automations go straight to the write action instead.
  const useAgent = intent.actionKey !== "update-files"
  let tail = previous
  let tailPort = previousPort
  if (useAgent) {
    const agent = place("agent.task", {
      prompt: text.trim().slice(0, 480) || intent.title,
    })
    connect(tail, tailPort, agent, "in")
    tail = agent
    tailPort = "out"
    notes.push("Added an agent task seeded with your request as the prompt.")
  }

  const terminal =
    intent.actionKey === "update-files"
      ? place("action.update-files", { target: "results/summary.json" })
      : place("action.post-summary", { channel })
  connect(tail, tailPort, terminal, "in")
  if (falseBranch) {
    connect(falseBranch.node, falseBranch.port, terminal, "in")
    notes.push("Connected the condition's false branch straight to the final action.")
  }

  notes.unshift(
    `Trigger: ${intent.triggerLabel}. Suggested ${graph.nodes.length} nodes from your description.`,
  )

  return { graph, intent, notes }
}
