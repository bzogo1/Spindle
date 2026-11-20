import { describe, expect, it } from "vitest"

import { dryRunGraph } from "./dry-run"
import { isGraphValid, validateGraph } from "./graph"
import { AUTOMATION_TEMPLATES } from "./templates"

describe("AUTOMATION_TEMPLATES", () => {
  it("exposes a non-empty catalog with unique ids", () => {
    expect(AUTOMATION_TEMPLATES.length).toBeGreaterThan(0)
    const ids = AUTOMATION_TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const template of AUTOMATION_TEMPLATES) {
      expect(template.name.trim().length).toBeGreaterThan(0)
      expect(template.description.trim().length).toBeGreaterThan(0)
    }
  })

  it.each(AUTOMATION_TEMPLATES.map((template) => [template.id, template] as const))(
    "%s builds a valid graph",
    (_id, template) => {
      const graph = template.build()
      expect(graph.name).toBe(template.name)
      expect(graph.nodes.length).toBeGreaterThan(0)
      expect(validateGraph(graph).filter((issue) => issue.severity === "error")).toEqual([])
      expect(isGraphValid(graph)).toBe(true)
      // Every template must be runnable: at least one trigger and one action.
      expect(graph.nodes.some((node) => node.type.startsWith("trigger."))).toBe(true)
      expect(graph.edges.length).toBeGreaterThan(0)
    },
  )

  it.each(AUTOMATION_TEMPLATES.map((template) => [template.id, template] as const))(
    "%s produces a fresh graph on each build",
    (_id, template) => {
      const first = template.build()
      const second = template.build()
      expect(first.id).not.toBe(second.id)
      expect(first.nodes.map((node) => node.id)).not.toEqual(second.nodes.map((node) => node.id))
    },
  )

  it.each(AUTOMATION_TEMPLATES.map((template) => [template.id, template] as const))(
    "%s dry-runs without node failures",
    (_id, template) => {
      const report = dryRunGraph(template.build())
      expect(report.status).not.toBe("rejected")
      expect(report.summary.failed).toBe(0)
      expect(report.summary.succeeded).toBeGreaterThan(0)
    },
  )
})
