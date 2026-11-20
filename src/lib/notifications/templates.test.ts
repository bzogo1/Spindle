import { describe, expect, it } from "vitest"

import {
  NOTIFICATION_TEMPLATES,
  getNotificationTemplate,
  renderNotificationTemplate,
} from "./templates"

describe("NOTIFICATION_TEMPLATES", () => {
  it("covers the common producer events", () => {
    const ids = NOTIFICATION_TEMPLATES.map((template) => template.id)
    for (const id of [
      "run-finished",
      "run-failed",
      "automation-triggered",
      "snapshot-diff-ready",
      "mention",
    ]) {
      expect(ids).toContain(id)
    }
  })

  it("declares unique ids and valid types/categories", () => {
    const ids = new Set<string>()
    for (const template of NOTIFICATION_TEMPLATES) {
      expect(ids.has(template.id)).toBe(false)
      ids.add(template.id)
      expect(["info", "success", "warning", "error"]).toContain(template.type)
      for (const variable of template.variables) {
        expect(template.title + template.body + (template.href ?? "")).toContain(
          `{{${variable.key}}}`,
        )
      }
    }
  })
})

describe("getNotificationTemplate", () => {
  it("finds templates by id and returns undefined for unknown ids", () => {
    expect(getNotificationTemplate("run-finished")?.label).toBe("Agent run finished")
    expect(getNotificationTemplate("nope")).toBeUndefined()
  })
})

describe("renderNotificationTemplate", () => {
  it("interpolates supplied variables and falls back to examples", () => {
    const template = getNotificationTemplate("run-finished")!
    const rendered = renderNotificationTemplate(template, { runName: "Deploy check" })
    expect(rendered.title).toBe("Run Deploy check finished")
    expect(rendered.body).toContain("Deploy check")
    // runId/duration fall back to their declared examples.
    expect(rendered.href).toBe("/app/agent/run_042")
    expect(rendered.body).toContain("4m 12s")
    expect(rendered.type).toBe("success")
    expect(rendered.category).toBe("agent")
  })

  it("renders demo-ready copy with no variables", () => {
    for (const template of NOTIFICATION_TEMPLATES) {
      const rendered = renderNotificationTemplate(template)
      expect(rendered.title.length).toBeGreaterThan(0)
      expect(rendered.title).not.toContain("{{")
      expect(rendered.body).not.toContain("{{")
    }
  })

  it("tidies whitespace left by empty substitutions", () => {
    const template = getNotificationTemplate("mention")!
    const rendered = renderNotificationTemplate(template, {
      author: "Ada",
      channel: "general",
      excerpt: "",
    })
    expect(rendered.body).not.toMatch(/\s{2,}/)
    expect(rendered.body.trim()).toBe(rendered.body)
  })
})
