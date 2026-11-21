import { describe, expect, it } from "vitest"

import {
  AUTOMATION_SHARE_GRAPH_MAX_CHARS,
  AUTOMATION_SHARE_PARAM,
  automationShareHref,
  automationToShareConfig,
  decodeAutomationShare,
  encodeAutomationShare,
  readAutomationShareParam,
  serializeAutomationConfig,
  type ShareableAutomation,
} from "./automation-share"

const AUTOMATION: ShareableAutomation = {
  name: "Daily results digest",
  actionKey: "post-summary",
  actionLabel: "Post run summary",
  prompt: "Summarize files changed since the previous run.",
  trigger: { kind: "schedule", label: "Schedule", detail: "At 09:00 AM, every day", meta: "0 9 * * *" },
  schedule: { kind: "cron", expr: "0 9 * * *" },
  createdVia: "cron",
  steps: [
    { kind: "trigger", label: "At 09:00 AM, every day", detail: "0 9 * * *" },
    { kind: "action", label: "Post run summary" },
  ],
}

describe("automation-share", () => {
  it("round-trips a config through encode/decode", () => {
    const config = automationToShareConfig(AUTOMATION)
    const decoded = decodeAutomationShare(encodeAutomationShare(config))
    expect(decoded).toEqual(config)
  })

  it("maps trigger meta to eventName/webhookUrl by kind", () => {
    const event = automationToShareConfig({
      ...AUTOMATION,
      trigger: { kind: "event", detail: "On file.uploaded", meta: "file.uploaded" },
    })
    expect(event.eventName).toBe("file.uploaded")
    expect(event.webhookUrl).toBeUndefined()

    const webhook = automationToShareConfig({
      ...AUTOMATION,
      createdVia: undefined,
      trigger: { kind: "webhook", detail: "Webhook", meta: "https://example.com/hook" },
    })
    expect(webhook.webhookUrl).toBe("https://example.com/hook")
    // Webhook triggers only exist in the graph model.
    expect(webhook.mode).toBe("graph")
  })

  it("round-trips an embedded graph payload and drops oversized ones", () => {
    const config = { ...automationToShareConfig(AUTOMATION), graph: '{"version":1,"graph":{}}' }
    expect(decodeAutomationShare(encodeAutomationShare(config))?.graph).toBe(config.graph)

    const oversized = {
      ...config,
      graph: "x".repeat(AUTOMATION_SHARE_GRAPH_MAX_CHARS + 1),
    }
    const decoded = decodeAutomationShare(encodeAutomationShare(oversized))
    expect(decoded).not.toBeNull()
    expect(decoded?.graph).toBeUndefined()
  })

  it("rejects malformed or foreign payloads", () => {
    expect(decodeAutomationShare("not-base64!!!")).toBeNull()
    expect(decodeAutomationShare(encodeAutomationShare({ version: 99 } as never))).toBeNull()
    expect(decodeAutomationShare(encodeAutomationShare({ ...automationToShareConfig(AUTOMATION), name: "" }))).toBeNull()
    // Raw JSON (not base64url) is rejected.
    expect(decodeAutomationShare(JSON.stringify(automationToShareConfig(AUTOMATION)))).toBeNull()
  })

  it("builds a share URL preserving unrelated params", () => {
    const config = automationToShareConfig(AUTOMATION)
    const href = automationShareHref(config, "https://app.example.com/app/automations?project=p1")
    const url = new URL(href)
    expect(url.pathname).toBe("/app/automations")
    expect(url.searchParams.get("project")).toBe("p1")
    expect(url.searchParams.get(AUTOMATION_SHARE_PARAM)).toBeTruthy()
    expect(readAutomationShareParam(url.search)).toEqual(config)
  })

  it("serializes config as JSON and YAML", () => {
    const config = automationToShareConfig(AUTOMATION)
    const json = serializeAutomationConfig(config, "json")
    expect(JSON.parse(json)).toEqual(config)
    const yaml = serializeAutomationConfig(config, "yaml")
    expect(yaml).toContain("name: Daily results digest")
    expect(yaml).toContain("triggerKind: schedule")
  })
})
