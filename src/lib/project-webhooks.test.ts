import { beforeEach, describe, expect, it } from "vitest"

import {
  clearProjectWebhookDeliveries,
  createProjectWebhookStore,
  fireProjectTestWebhook,
  getProjectWebhook,
  isValidProjectWebhookUrl,
  listProjectWebhookDeliveries,
  listProjectWebhooks,
  loadProjectWebhookStore,
  removeProjectWebhook,
  saveNewProjectWebhook,
  setProjectWebhookEnabled,
  updateProjectWebhook,
  validateProjectWebhookInput,
} from "./project-webhooks"

const PROJECT_ID = "prj_01"

beforeEach(() => {
  window.localStorage.clear()
})

describe("validateProjectWebhookInput", () => {
  it("accepts a valid input", () => {
    const result = validateProjectWebhookInput({
      url: "https://example.com/hook",
      events: ["project.created", "file.uploaded"],
    })
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("rejects a missing or invalid URL", () => {
    expect(validateProjectWebhookInput({ url: "", events: ["project.created"] }).ok).toBe(false)
    expect(validateProjectWebhookInput({ url: "not-a-url", events: ["project.created"] }).ok).toBe(
      false,
    )
    expect(
      validateProjectWebhookInput({ url: "ftp://example.com", events: ["project.created"] }).ok,
    ).toBe(false)
  })

  it("rejects empty or unknown events", () => {
    expect(validateProjectWebhookInput({ url: "https://example.com", events: [] }).ok).toBe(false)
    const result = validateProjectWebhookInput({
      url: "https://example.com",
      // @ts-expect-error — unknown event on purpose
      events: ["project.created", "bogus.event"],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(" ")).toContain("bogus.event")
  })
})

describe("isValidProjectWebhookUrl", () => {
  it("accepts http(s) absolute URLs only", () => {
    expect(isValidProjectWebhookUrl("https://example.com/hook")).toBe(true)
    expect(isValidProjectWebhookUrl("http://localhost:3000/hook")).toBe(true)
    expect(isValidProjectWebhookUrl("example.com/hook")).toBe(false)
    expect(isValidProjectWebhookUrl("mailto:a@b.c")).toBe(false)
  })
})

describe("store", () => {
  it("creates webhooks with deduped events and persists them", () => {
    const created = saveNewProjectWebhook(PROJECT_ID, {
      url: "https://example.com/hook",
      events: ["project.created", "project.created"],
      secret: "whsec_test",
    })
    expect(created.ok).toBe(true)
    expect(created.persisted).toBe(true)
    expect(created.webhook?.events).toEqual(["project.created"])
    expect(created.webhook?.secret).toBe("whsec_test")
    expect(created.webhook?.enabled).toBe(true)

    expect(listProjectWebhooks(PROJECT_ID)).toHaveLength(1)
    expect(getProjectWebhook(PROJECT_ID, created.webhook!.id)?.url).toBe("https://example.com/hook")
  })

  it("scopes stores per project", () => {
    saveNewProjectWebhook(PROJECT_ID, {
      url: "https://example.com/a",
      events: ["project.created"],
    })
    saveNewProjectWebhook("prj_02", {
      url: "https://example.com/b",
      events: ["project.created"],
    })
    expect(listProjectWebhooks(PROJECT_ID)).toHaveLength(1)
    expect(listProjectWebhooks("prj_02")).toHaveLength(1)
    expect(listProjectWebhooks("prj_03")).toHaveLength(0)
  })

  it("rejects invalid input without persisting", () => {
    const result = saveNewProjectWebhook(PROJECT_ID, {
      url: "nope",
      events: [],
    })
    expect(result.ok).toBe(false)
    expect(listProjectWebhooks(PROJECT_ID)).toHaveLength(0)
  })

  it("updates and toggles enabled state", () => {
    const created = saveNewProjectWebhook(PROJECT_ID, {
      url: "https://example.com/hook",
      events: ["project.created"],
    })
    const webhook = created.webhook!
    updateProjectWebhook(PROJECT_ID, { ...webhook, url: "https://example.com/new" })
    expect(getProjectWebhook(PROJECT_ID, webhook.id)?.url).toBe("https://example.com/new")

    expect(setProjectWebhookEnabled(PROJECT_ID, webhook.id, false)).toBe(true)
    expect(getProjectWebhook(PROJECT_ID, webhook.id)?.enabled).toBe(false)
    expect(setProjectWebhookEnabled(PROJECT_ID, "wh_missing", true)).toBe(false)
  })

  it("removes webhooks and their deliveries", () => {
    const created = saveNewProjectWebhook(PROJECT_ID, {
      url: "https://example.com/hook",
      events: ["project.created"],
    })
    const webhook = created.webhook!
    fireProjectTestWebhook(PROJECT_ID, webhook)
    expect(listProjectWebhookDeliveries(PROJECT_ID)).toHaveLength(1)

    expect(removeProjectWebhook(PROJECT_ID, webhook.id)).toBe(true)
    expect(listProjectWebhooks(PROJECT_ID)).toHaveLength(0)
    expect(listProjectWebhookDeliveries(PROJECT_ID)).toHaveLength(0)
    expect(removeProjectWebhook(PROJECT_ID, webhook.id)).toBe(false)
  })
})

describe("test-fire delivery log", () => {
  it("records a mock webhook.test delivery without network", () => {
    const created = saveNewProjectWebhook(PROJECT_ID, {
      url: "https://example.com/hook",
      events: ["project.created"],
      secret: "whsec_test",
    })
    const delivery = fireProjectTestWebhook(PROJECT_ID, created.webhook!)

    expect(delivery.event).toBe("webhook.test")
    expect(delivery.status).toBe("success")
    expect(delivery.webhookId).toBe(created.webhook!.id)
    expect(delivery.responseSnippet).toContain("Mock delivery")

    const logged = listProjectWebhookDeliveries(PROJECT_ID)
    expect(logged).toHaveLength(1)
    expect(logged[0].id).toBe(delivery.id)
  })

  it("lists deliveries newest first and clears the log", () => {
    const created = saveNewProjectWebhook(PROJECT_ID, {
      url: "https://example.com/hook",
      events: ["project.created"],
    })
    const webhook = created.webhook!
    fireProjectTestWebhook(PROJECT_ID, webhook)
    fireProjectTestWebhook(PROJECT_ID, webhook)
    expect(listProjectWebhookDeliveries(PROJECT_ID)).toHaveLength(2)

    expect(clearProjectWebhookDeliveries(PROJECT_ID)).toBe(true)
    expect(listProjectWebhookDeliveries(PROJECT_ID)).toHaveLength(0)
    expect(listProjectWebhooks(PROJECT_ID)).toHaveLength(1)
  })
})

describe("load/save round-trip", () => {
  it("returns an empty store for corrupt data", () => {
    window.localStorage.setItem(
      "spindle.project-webhooks.v1.prj_01",
      JSON.stringify({ version: 99, webhooks: "nope" }),
    )
    expect(loadProjectWebhookStore(PROJECT_ID)).toEqual(createProjectWebhookStore())
  })

  it("filters malformed entries out of a stored store", () => {
    window.localStorage.setItem(
      "spindle.project-webhooks.v1.prj_01",
      JSON.stringify({
        version: 1,
        webhooks: [{ id: "wh_ok" }, { bogus: true }],
        deliveries: [{ id: "d1" }, "junk"],
      }),
    )
    const store = loadProjectWebhookStore(PROJECT_ID)
    expect(store.webhooks).toHaveLength(0)
    expect(store.deliveries).toHaveLength(0)
  })
})
