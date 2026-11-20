import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AgentRunWebhookPanel } from "./agent-run-webhook-panel"
import {
  clearWebhookStore,
  listWebhookDeliveries,
  saveNewAgentRunWebhook,
  type WebhookFetchImpl,
} from "@/lib/agent-runs/ops/webhooks"

const okFetch: WebhookFetchImpl = async () => ({
  ok: true,
  status: 200,
  text: async () => "ok",
})

describe("AgentRunWebhookPanel", () => {
  beforeEach(() => {
    clearWebhookStore()
  })

  it("shows empty state", () => {
    render(<AgentRunWebhookPanel />)
    expect(screen.getByText(/No webhooks yet/)).toBeInTheDocument()
    expect(screen.getByText(/No deliveries yet/)).toBeInTheDocument()
  })

  it("lists existing webhooks and deliveries", () => {
    saveNewAgentRunWebhook({
      name: "CI hook",
      url: "https://example.com/hook",
      events: ["run.completed"],
    })
    render(<AgentRunWebhookPanel />)
    expect(screen.getByText("CI hook")).toBeInTheDocument()
    expect(screen.getByText("https://example.com/hook")).toBeInTheDocument()
    expect(screen.getAllByText("run.completed").length).toBeGreaterThan(0)
  })

  it("adds a webhook through the form", () => {
    render(<AgentRunWebhookPanel />)
    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: "https://example.com/new" },
    })
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "New hook" } })
    fireEvent.click(screen.getByRole("button", { name: "Add webhook" }))
    expect(screen.getByText("New hook")).toBeInTheDocument()
  })

  it("shows validation errors for a bad URL", () => {
    render(<AgentRunWebhookPanel />)
    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: "ftp://example.com/hook" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add webhook" }))
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })

  it("test-fires a webhook and logs the delivery", async () => {
    const fetchImpl = vi.fn(okFetch)
    saveNewAgentRunWebhook({
      name: "Testable",
      url: "https://example.com/hook",
      events: ["run.completed"],
    })
    render(<AgentRunWebhookPanel fetchImpl={fetchImpl} />)
    fireEvent.click(screen.getByRole("button", { name: "Test" }))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(await screen.findByText("webhook.test")).toBeInTheDocument()
    expect(listWebhookDeliveries()).toHaveLength(1)
    expect(listWebhookDeliveries()[0].status).toBe("success")
  })

  it("toggles and deletes webhooks", () => {
    const created = saveNewAgentRunWebhook({
      name: "Removable",
      url: "https://example.com/hook",
      events: ["run.completed"],
    })
    render(<AgentRunWebhookPanel />)
    fireEvent.click(screen.getByRole("button", { name: "enabled" }))
    expect(screen.getByRole("button", { name: "disabled" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Delete webhook Removable" }))
    expect(screen.queryByText("Removable")).not.toBeInTheDocument()
    expect(created.webhook).toBeDefined()
  })

  it("scopes the form to a run when runId is provided", () => {
    render(<AgentRunWebhookPanel runId="run_42" />)
    expect(screen.getByLabelText("Scope")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: "https://example.com/scoped" },
    })
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "run" } })
    fireEvent.click(screen.getByRole("button", { name: "Add webhook" }))
    expect(screen.getByText("run_42")).toBeInTheDocument()
  })
})
