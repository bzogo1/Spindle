import { describe, expect, it } from "vitest"

import {
  BUILTIN_AGENT_RUN_TEMPLATES,
  getAgentRunTemplate,
  groupAgentRunTemplatesByCategory,
  instantiateRunFromTemplate,
  listAgentRunTemplates,
  registerAgentRunTemplate,
  unregisterAgentRunTemplate,
  type AgentRunTemplate,
} from "./templates"
import { isActiveOpsRun, runDurationMs, stepDurationMs } from "./types"
import { buildOpsRun, buildOpsStep } from "./fixtures"

describe("templates", () => {
  it("ships a non-empty builtin registry with unique ids", () => {
    const templates = listAgentRunTemplates()
    expect(templates.length).toBe(BUILTIN_AGENT_RUN_TEMPLATES.length)
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length)
    for (const t of templates) {
      expect(t.prompt.length).toBeGreaterThan(0)
      expect(t.name.length).toBeGreaterThan(0)
    }
  })

  it("getAgentRunTemplate resolves builtins and misses cleanly", () => {
    expect(getAgentRunTemplate("tpl.code-review")?.name).toBe("Code review")
    expect(getAgentRunTemplate("nope")).toBeNull()
  })

  it("register/unregister round-trips custom templates", () => {
    const custom: AgentRunTemplate = {
      id: "tpl.custom",
      name: "Custom",
      version: 1,
      description: "d",
      category: "custom",
      prompt: "p",
      config: {},
    }
    registerAgentRunTemplate(custom)
    expect(getAgentRunTemplate("tpl.custom")).toEqual(custom)
    expect(unregisterAgentRunTemplate("tpl.custom")).toBe(true)
    expect(getAgentRunTemplate("tpl.custom")).toBeNull()
    expect(unregisterAgentRunTemplate("tpl.custom")).toBe(false)
  })

  it("groups templates by category preserving order", () => {
    const groups = groupAgentRunTemplatesByCategory()
    const categories = [...groups.keys()]
    expect(categories).toContain("engineering")
    expect(categories).toContain("docs")
    const eng = groups.get("engineering") ?? []
    expect(eng.every((t) => t.category === "engineering")).toBe(true)
  })

  it("instantiates a queued run seeded from template config", () => {
    const template = getAgentRunTemplate("tpl.incident-triage")!
    const run = instantiateRunFromTemplate(template, {
      prompt: "Override prompt",
      extraTags: ["extra"],
      projectId: "prj_1",
      now: new Date("2026-01-01T00:00:00Z"),
    })
    expect(run.status).toBe("queued")
    expect(run.prompt).toBe("Override prompt")
    expect(run.model).toBe("ops-large")
    expect(run.templateId).toBe(template.id)
    expect(run.templateVersion).toBe(template.version)
    expect(run.retentionDays).toBe(365)
    expect(run.tags).toContain("ops")
    expect(run.tags).toContain("extra")
    expect(run.createdAt).toBe("2026-01-01T00:00:00.000Z")
    expect(run.steps).toEqual([])
    expect(run.events).toEqual([])
  })

  it("uses the template prompt when no override is given", () => {
    const template = getAgentRunTemplate("tpl.docs-summarizer")!
    const run = instantiateRunFromTemplate(template)
    expect(run.prompt).toBe(template.prompt)
  })
})

describe("run helpers", () => {
  it("computes duration from startedAt to finishedAt", () => {
    const run = buildOpsRun()
    expect(runDurationMs(run)).toBe(239_000) // 09:30:01 → 09:34:00
  })

  it("uses createdAt when startedAt is missing and now for active runs", () => {
    const run = buildOpsRun({
      status: "running",
      startedAt: undefined,
      finishedAt: undefined,
      createdAt: "2026-11-19T09:30:00.000Z",
    })
    expect(runDurationMs(run, new Date("2026-11-19T09:30:30.000Z").getTime())).toBe(30_000)
  })

  it("returns null duration for bad timestamps", () => {
    const run = buildOpsRun({ createdAt: "not-a-date", startedAt: undefined })
    expect(runDurationMs(run)).toBeNull()
  })

  it("prefers explicit durationMs then derives from endedAt", () => {
    expect(stepDurationMs(buildOpsStep({ durationMs: 42 }))).toBe(42)
    expect(
      stepDurationMs(
        buildOpsStep({
          durationMs: undefined,
          startedAt: "2026-01-01T00:00:00Z",
          endedAt: "2026-01-01T00:00:05Z",
        }),
      ),
    ).toBe(5000)
    expect(stepDurationMs(buildOpsStep({ durationMs: undefined, endedAt: undefined }))).toBeNull()
  })

  it("classifies active statuses", () => {
    expect(isActiveOpsRun("running")).toBe(true)
    expect(isActiveOpsRun("waiting_approval")).toBe(true)
    expect(isActiveOpsRun("succeeded")).toBe(false)
    expect(isActiveOpsRun("failed")).toBe(false)
  })
})
