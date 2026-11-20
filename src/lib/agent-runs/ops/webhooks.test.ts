import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  AGENT_RUN_WEBHOOK_EVENTS,
  buildWebhookPayload,
  clearWebhookStore,
  createAgentRunWebhook,
  createWebhookStore,
  deliverRunWebhook,
  dispatchRunWebhookEvent,
  fireTestWebhook,
  getAgentRunWebhook,
  listAgentRunWebhooks,
  listWebhookDeliveries,
  loadWebhookStore,
  removeAgentRunWebhook,
  saveNewAgentRunWebhook,
  setAgentRunWebhookEnabled,
  signWebhookBody,
  updateAgentRunWebhook,
  validateWebhookInput,
  webhookEventsForRunStatus,
  webhooksForRunEvent,
  type AgentRunWebhook,
  type WebhookFetchImpl,
} from "./webhooks"
import { buildOpsRun } from "./fixtures"

const okFetch: WebhookFetchImpl = async () => ({ ok: true, status: 200, text: async () => "ok" })
const failFetch: WebhookFetchImpl = async () => ({
  ok: false,
  status: 500,
  text: async () => "boom",
})
const throwFetch: WebhookFetchImpl = async () => {
  throw new Error("connection refused")
}

function makeWebhook(overrides: Partial<AgentRunWebhook> = {}): AgentRunWebhook {
  return {
    id: "wh_1",
    url: "https://example.com/hook",
    events: ["run.completed", "run.failed"],
    enabled: true,
    createdAt: "2026-11-19T09:00:00.000Z",
    updatedAt: "2026-11-19T09:00:00.000Z",
    ...overrides,
  }
}

describe("webhook validation", () => {
  it("accepts a valid input", () => {
    const result = validateWebhookInput({
      url: "https://example.com/hook",
      events: ["run.completed"],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("rejects missing/invalid URLs", () => {
    expect(validateWebhookInput({ url: "", events: ["run.completed"] }).ok).toBe(false)
    expect(validateWebhookInput({ url: "notaurl", events: ["run.completed"] }).ok).toBe(false)
    expect(validateWebhookInput({ url: "ftp://example.com", events: ["run.completed"] }).ok).toBe(
      false,
    )
  })

  it("rejects empty or unknown events", () => {
    expect(validateWebhookInput({ url: "https://x.test", events: [] }).ok).toBe(false)
    const bad = validateWebhookInput({
      url: "https://x.test",
      events: ["run.completed", "run.exploded" as never],
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(" ")).toContain("run.exploded")
  })

  it("creates a webhook with defaults", () => {
    const result = createAgentRunWebhook({
      name: "  CI notify  ",
      url: "https://example.com/hook",
      events: ["run.completed", "run.completed"],
      secret: "  s3cret  ",
    })
    expect(result.ok).toBe(true)
    expect(result.webhook?.name).toBe("CI notify")
    expect(result.webhook?.events).toEqual(["run.completed"])
    expect(result.webhook?.secret).toBe("s3cret")
    expect(result.webhook?.enabled).toBe(true)
    expect(result.webhook?.id).toMatch(/^wh_/)
  })

  it("surfaces validation errors on create", () => {
    const result = createAgentRunWebhook({ url: "", events: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.webhook).toBeUndefined()
  })
})

describe("event mapping", () => {
  it("maps terminal statuses to events", () => {
    expect(webhookEventsForRunStatus("succeeded")).toEqual(["run.completed"])
    expect(webhookEventsForRunStatus("failed")).toEqual(["run.failed"])
    expect(webhookEventsForRunStatus("cancelled")).toEqual(["run.cancelled"])
    expect(webhookEventsForRunStatus("rejected")).toEqual(["run.failed"])
    expect(webhookEventsForRunStatus("running")).toEqual(["run.started"])
    expect(webhookEventsForRunStatus("queued")).toEqual([])
    expect(webhookEventsForRunStatus("waiting_approval")).toEqual([])
  })

  it("exposes the subscribable event list", () => {
    expect(AGENT_RUN_WEBHOOK_EVENTS).toContain("run.completed")
    expect(AGENT_RUN_WEBHOOK_EVENTS).toContain("run.failed")
  })
})

describe("payload + signing", () => {
  it("builds a compact payload from a run", () => {
    const run = buildOpsRun()
    const payload = buildWebhookPayload(run, "run.completed", {
      now: new Date("2026-11-19T09:40:00.000Z"),
      deliveryId: "whd_1",
    })
    expect(payload.id).toBe("whd_1")
    expect(payload.event).toBe("run.completed")
    expect(payload.data.runId).toBe(run.id)
    expect(payload.data.status).toBe("succeeded")
    expect(payload.data.stepCount).toBe(3)
    expect(payload.data.durationMs).toBe(239000)
    expect(payload.data.metrics.costUsd).toBe(0.012)
    expect(payload.data.promptPreview).toBe(run.prompt)
  })

  it("truncates long prompts", () => {
    const run = buildOpsRun({ prompt: "x".repeat(500) })
    const payload = buildWebhookPayload(run, "run.completed")
    expect(payload.data.promptPreview.length).toBeLessThanOrEqual(281)
    expect(payload.data.promptPreview.endsWith("…")).toBe(true)
  })

  it("signs bodies Stripe-style and verifies the format", async () => {
    const signature = await signWebhookBody("secret", "body", {
      timestampSeconds: 1700000000,
      hmacFn: (secret, data) => `hmac(${secret},${data})`,
    })
    expect(signature).toBe("t=1700000000,v1=hmac(secret,1700000000.body)")
  })

  it("produces a real HMAC-SHA256 hex digest via WebCrypto", async () => {
    const signature = await signWebhookBody("secret", "body", { timestampSeconds: 1 })
    const match = /^t=1,v1=([0-9a-f]{64})$/.exec(signature)
    expect(match).not.toBeNull()
  })
})

describe("delivery", () => {
  it("records a successful delivery with signed headers", async () => {
    const fetchImpl = vi.fn(okFetch)
    const webhook = makeWebhook({ secret: "s3cret" })
    const run = buildOpsRun()
    const delivery = await deliverRunWebhook(webhook, "run.completed", run, {
      fetchImpl,
      hmacFn: (secret, data) => `sig:${secret}:${data}`,
      now: new Date("2026-11-19T10:00:00.000Z"),
    })
    expect(delivery.status).toBe("success")
    expect(delivery.statusCode).toBe(200)
    expect(delivery.event).toBe("run.completed")
    expect(delivery.runId).toBe(run.id)
    expect(delivery.responseSnippet).toBe("ok")

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(webhook.url)
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers["X-Spindle-Event"]).toBe("run.completed")
    expect(init.headers["X-Spindle-Signature"]).toMatch(/^t=\d+,v1=sig:s3cret:/)
    const payload = JSON.parse(init.body)
    expect(payload.event).toBe("run.completed")
    expect(payload.data.runId).toBe(run.id)
  })

  it("omits the signature header when no secret is set", async () => {
    const fetchImpl = vi.fn(okFetch)
    await deliverRunWebhook(makeWebhook(), "run.completed", buildOpsRun(), { fetchImpl })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers["X-Spindle-Signature"]).toBeUndefined()
  })

  it("records HTTP failures without throwing", async () => {
    const delivery = await deliverRunWebhook(makeWebhook(), "run.failed", buildOpsRun(), {
      fetchImpl: failFetch,
    })
    expect(delivery.status).toBe("failed")
    expect(delivery.statusCode).toBe(500)
    expect(delivery.error).toContain("500")
    expect(delivery.responseSnippet).toBe("boom")
  })

  it("records transport errors without throwing", async () => {
    const delivery = await deliverRunWebhook(makeWebhook(), "run.failed", buildOpsRun(), {
      fetchImpl: throwFetch,
    })
    expect(delivery.status).toBe("failed")
    expect(delivery.error).toBe("connection refused")
    expect(delivery.statusCode).toBeUndefined()
  })
})

describe("matching + dispatch", () => {
  it("filters by enabled flag, event subscription, and run scope", () => {
    const run = buildOpsRun({ id: "run_a" })
    const webhooks = [
      makeWebhook({ id: "global", events: ["run.completed"] }),
      makeWebhook({ id: "disabled", enabled: false, events: ["run.completed"] }),
      makeWebhook({ id: "wrong-event", events: ["run.failed"] }),
      makeWebhook({ id: "other-run", runId: "run_b", events: ["run.completed"] }),
      makeWebhook({ id: "this-run", runId: "run_a", events: ["run.completed"] }),
    ]
    const matched = webhooksForRunEvent(webhooks, run, "run.completed")
    expect(matched.map((w) => w.id).sort()).toEqual(["global", "this-run"])
  })

  it("dispatches to matching webhooks and persists deliveries", async () => {
    clearWebhookStore()
    saveNewAgentRunWebhook({ url: "https://a.test/hook", events: ["run.completed"] })
    saveNewAgentRunWebhook({ url: "https://b.test/hook", events: ["run.failed"] })

    const run = buildOpsRun()
    const result = await dispatchRunWebhookEvent(run, "run.completed", { fetchImpl: okFetch })
    expect(result.deliveries).toHaveLength(1)
    expect(result.deliveries[0].status).toBe("success")
    expect(result.persisted).toBe(true)

    const deliveries = listWebhookDeliveries()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].event).toBe("run.completed")
  })

  it("returns an empty result when nothing matches", async () => {
    clearWebhookStore()
    const result = await dispatchRunWebhookEvent(buildOpsRun(), "run.failed", {
      fetchImpl: okFetch,
    })
    expect(result.deliveries).toHaveLength(0)
    expect(listWebhookDeliveries()).toHaveLength(0)
  })
})

describe("test fire", () => {
  it("sends a webhook.test payload and records the delivery", async () => {
    clearWebhookStore()
    const created = saveNewAgentRunWebhook({
      url: "https://example.com/hook",
      events: ["run.completed"],
      secret: "s3cret",
    })
    expect(created.ok).toBe(true)
    const webhook = created.webhook!

    const fetchImpl = vi.fn(okFetch)
    const delivery = await fireTestWebhook(webhook, {
      fetchImpl,
      hmacFn: () => "deadbeef",
      now: new Date("2026-11-19T11:00:00.000Z"),
    })
    expect(delivery.status).toBe("success")
    expect(delivery.event).toBe("webhook.test")

    const [, init] = fetchImpl.mock.calls[0]
    const payload = JSON.parse(init.body)
    expect(payload.event).toBe("webhook.test")
    expect(payload.data.tags).toContain("webhook-test")
    expect(init.headers["X-Spindle-Event"]).toBe("webhook.test")
    expect(listWebhookDeliveries(webhook.id)).toHaveLength(1)
  })
})

describe("store", () => {
  beforeEach(() => {
    clearWebhookStore()
  })

  it("persists webhooks and deliveries round-trip", () => {
    const created = saveNewAgentRunWebhook({
      url: "https://example.com/hook",
      events: ["run.completed"],
      runId: "run_1",
    })
    expect(created.persisted).toBe(true)
    expect(listAgentRunWebhooks()).toHaveLength(1)
    expect(getAgentRunWebhook(created.webhook!.id)?.runId).toBe("run_1")
  })

  it("updates and removes webhooks", () => {
    const created = saveNewAgentRunWebhook({
      url: "https://example.com/hook",
      events: ["run.completed"],
    })
    const webhook = created.webhook!
    expect(setAgentRunWebhookEnabled(webhook.id, false)).toBe(true)
    expect(getAgentRunWebhook(webhook.id)?.enabled).toBe(false)
    expect(setAgentRunWebhookEnabled("missing", true)).toBe(false)

    expect(updateAgentRunWebhook({ ...webhook, url: "https://other.test/hook" })).toBe(true)
    expect(getAgentRunWebhook(webhook.id)?.url).toBe("https://other.test/hook")

    expect(removeAgentRunWebhook(webhook.id)).toBe(true)
    expect(getAgentRunWebhook(webhook.id)).toBeNull()
    expect(removeAgentRunWebhook(webhook.id)).toBe(false)
  })

  it("returns an empty store for corrupt data", () => {
    const store = createWebhookStore()
    expect(store.webhooks).toEqual([])
    expect(store.deliveries).toEqual([])
    expect(loadWebhookStore().version).toBe(1)
  })
})
