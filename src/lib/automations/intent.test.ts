import { describe, expect, it } from "vitest"

import {
  builderStateFromCron,
  buildGraphFromIntent,
  cronForBuilderSchedule,
  parseAutomationIntent,
} from "./intent"
import { dryRunGraph, isGraphValid } from "@/lib/automation-graph"

describe("parseAutomationIntent", () => {
  it("parses a weekly schedule request", () => {
    const intent = parseAutomationIntent(
      "Every Monday at 8am summarize new papers and email me a digest",
    )
    expect(intent.triggerKind).toBe("schedule")
    expect(intent.cron).toBe("0 8 * * 1")
    expect(intent.title).toBe("Weekly paper summary")
    expect(intent.actionKey).toBe("post-summary")
    expect(intent.steps.length).toBeGreaterThan(1)
  })

  it("parses a file-event request", () => {
    const intent = parseAutomationIntent("When a new CSV lands, clean and normalize it")
    expect(intent.triggerKind).toBe("event")
    expect(intent.eventName).toBe("file.uploaded")
    expect(intent.title).toBe("New file workflow")
  })

  it("defaults to a daily 17:00 schedule", () => {
    const intent = parseAutomationIntent("check results for outliers")
    expect(intent.cron).toBe("0 17 * * *")
    expect(intent.triggerKind).toBe("schedule")
  })
})

describe("cronForBuilderSchedule", () => {
  it("builds daily and weekly expressions", () => {
    expect(cronForBuilderSchedule("daily", "09:30", [1])).toBe("30 9 * * *")
    expect(cronForBuilderSchedule("weekly", "17:00", [5, 1])).toBe("0 17 * * 1,5")
    expect(cronForBuilderSchedule("weekly", "17:00", [])).toBeNull()
    expect(cronForBuilderSchedule("daily", "25:00", [1])).toBeNull()
  })
})

describe("builderStateFromCron", () => {
  it("restores daily and weekly builder state", () => {
    expect(builderStateFromCron("30 9 * * *")).toEqual({
      frequency: "daily",
      time: "09:30",
      days: [1],
    })
    expect(builderStateFromCron("0 17 * * 5")).toEqual({
      frequency: "weekly",
      time: "17:00",
      days: [5],
    })
    expect(builderStateFromCron("0 17 * * 7")).toEqual({
      frequency: "weekly",
      time: "17:00",
      days: [0],
    })
  })

  it("rejects schedules the builder cannot express", () => {
    expect(builderStateFromCron("0 9 1 * *")).toBeNull()
    expect(builderStateFromCron("*/15 * * * *")).toBeNull()
    expect(builderStateFromCron("0 9 * * 1-5")).toBeNull()
    expect(builderStateFromCron("nope")).toBeNull()
  })
})

describe("buildGraphFromIntent", () => {
  it("builds a connected graph from a schedule request", () => {
    const result = buildGraphFromIntent(
      "Every Monday at 8am summarize new papers and post a digest to #papers",
    )
    expect(result.graph.nodes.length).toBeGreaterThanOrEqual(3)
    expect(result.graph.edges.length).toBe(result.graph.nodes.length - 1)
    expect(isGraphValid(result.graph)).toBe(true)
    const report = dryRunGraph(result.graph)
    expect(report.status).toBe("success")
  })

  it("uses an event trigger for file uploads", () => {
    const result = buildGraphFromIntent("When a new CSV lands, clean and normalize it")
    const trigger = result.graph.nodes.find((n) => n.type === "trigger.event")
    expect(trigger).toBeDefined()
    expect(trigger?.config.event).toBe("file.uploaded")
    // wantsClean → a transform node is included.
    expect(result.graph.nodes.some((n) => n.type === "transform")).toBe(true)
    // actionKey update-files → terminal is action.update-files, no agent task.
    expect(result.graph.nodes.some((n) => n.type === "agent.task")).toBe(false)
    expect(result.graph.nodes.some((n) => n.type === "action.update-files")).toBe(true)
  })

  it("adds a condition branch for flag/outlier requests", () => {
    const result = buildGraphFromIntent("Every day at 9am check results for outliers")
    expect(result.graph.nodes.some((n) => n.type === "condition")).toBe(true)
    const condition = result.graph.nodes.find((n) => n.type === "condition")!
    const outPorts = result.graph.edges
      .filter((e) => e.sourceNodeId === condition.id)
      .map((e) => e.sourcePort)
    expect(outPorts).toContain("true")
    expect(outPorts).toContain("false")
  })

  it("fills the agent prompt from the request text", () => {
    const result = buildGraphFromIntent("summarize my data every day")
    const agent = result.graph.nodes.find((n) => n.type === "agent.task")
    expect(agent?.config.prompt).toContain("summarize my data")
  })
})

describe("wantsFlag precision", () => {
  it("does not treat a bare 'check' as an outlier request", () => {
    const intent = parseAutomationIntent("check my email every morning")
    expect(intent.actionKey).not.toBe("agent-task")
    const result = buildGraphFromIntent("check my email every morning")
    expect(result.graph.nodes.some((n) => n.type === "condition")).toBe(false)
  })

  it("still detects explicit outlier/flag language", () => {
    const result = buildGraphFromIntent("check for outliers in the data every day")
    expect(result.graph.nodes.some((n) => n.type === "condition")).toBe(true)
  })
})
