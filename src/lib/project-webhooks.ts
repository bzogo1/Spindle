"use client"

/**
 * Project webhooks — outbound event subscriptions configured in project
 * settings.
 *
 * There is no webhooks API yet, so endpoints, signing secrets, and the
 * delivery log persist to localStorage per project
 * (`spindle.project-webhooks.v1.<projectId>`) via the same guarded-storage
 * posture as `settings-audit` — SSR- and privacy-mode safe, surviving
 * reloads within the same browser. The store mirrors the agent-run ops
 * webhook module (`agent-runs/ops/webhooks.ts`) but uses the project event
 * vocabulary from the settings screen.
 *
 * "Test" deliveries are MOCKED: `fireProjectTestWebhook` records a synthetic
 * `webhook.test` entry in the delivery log without sending an HTTP request —
 * real dispatch lands when the backend webhook dispatcher ships.
 */

import { storageGetJson, storageSetJson, storageRemove } from "@/lib/agent-runs/ops/storage"

export const PROJECT_WEBHOOK_EVENTS = [
  "project.created",
  "project.updated",
  "file.uploaded",
  "file.deleted",
  "lab.session.started",
  "lab.session.finished",
  "agent.run.started",
  "agent.run.finished",
  "chat.message.sent",
] as const

export type ProjectWebhookEvent = (typeof PROJECT_WEBHOOK_EVENTS)[number]

/** Synthetic event used by the test-fire button; not subscribable. */
export type ProjectWebhookDeliveryEvent = ProjectWebhookEvent | "webhook.test"

export interface ProjectWebhook {
  id: string
  /** Endpoint URL — must be absolute http(s). */
  url: string
  /** Subscribed project events; at least one required. */
  events: ProjectWebhookEvent[]
  /** Optional HMAC-SHA256 signing secret (shown once at creation). */
  secret?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ProjectWebhookDeliveryStatus = "success" | "failed"

export interface ProjectWebhookDelivery {
  id: string
  webhookId: string
  event: ProjectWebhookDeliveryEvent
  url: string
  status: ProjectWebhookDeliveryStatus
  /** HTTP status code when a real response was received (never for mocks). */
  statusCode?: number
  durationMs: number
  attemptedAt: string
  /** Failure reason or transport error message. */
  error?: string
  /** Truncated response body snippet or mock marker. */
  responseSnippet?: string
}

export interface ProjectWebhookStore {
  version: 1
  webhooks: ProjectWebhook[]
  deliveries: ProjectWebhookDelivery[]
}

/** Delivery log is capped; oldest entries are dropped first. */
export const MAX_PROJECT_WEBHOOK_DELIVERIES = 100

function storageKey(projectId: string) {
  return `spindle.project-webhooks.v1.${projectId}`
}

export function createProjectWebhookStore(): ProjectWebhookStore {
  return { version: 1, webhooks: [], deliveries: [] }
}

function isProjectWebhook(value: unknown): value is ProjectWebhook {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<ProjectWebhook>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.url === "string" &&
    Array.isArray(candidate.events) &&
    typeof candidate.enabled === "boolean" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  )
}

function isProjectWebhookDelivery(value: unknown): value is ProjectWebhookDelivery {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<ProjectWebhookDelivery>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.webhookId === "string" &&
    typeof candidate.url === "string" &&
    (candidate.status === "success" || candidate.status === "failed") &&
    typeof candidate.durationMs === "number" &&
    typeof candidate.attemptedAt === "string"
  )
}

export function loadProjectWebhookStore(projectId: string): ProjectWebhookStore {
  const stored = storageGetJson<Partial<ProjectWebhookStore>>(storageKey(projectId), {})
  if (stored.version !== 1 || !Array.isArray(stored.webhooks)) {
    return createProjectWebhookStore()
  }
  return {
    version: 1,
    webhooks: stored.webhooks.filter(isProjectWebhook),
    deliveries: Array.isArray(stored.deliveries)
      ? stored.deliveries.filter(isProjectWebhookDelivery)
      : [],
  }
}

export function saveProjectWebhookStore(projectId: string, store: ProjectWebhookStore): boolean {
  return storageSetJson(storageKey(projectId), store)
}

export function clearProjectWebhookStore(projectId: string): void {
  storageRemove(storageKey(projectId))
}

/* ------------------------------------------------------------------------ */
/* Validation + CRUD                                                         */
/* ------------------------------------------------------------------------ */

export interface ProjectWebhookInput {
  url: string
  events: ProjectWebhookEvent[]
  secret?: string
  enabled?: boolean
}

export interface ProjectWebhookValidation {
  ok: boolean
  errors: string[]
}

/** Accepts absolute http(s) URLs — anything the WHATWG parser can read. */
export function isValidProjectWebhookUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

/** Validate a webhook draft; trims/normalizes nothing (callers persist as-is). */
export function validateProjectWebhookInput(input: ProjectWebhookInput): ProjectWebhookValidation {
  const errors: string[] = []

  const url = input.url.trim()
  if (!url) {
    errors.push("Endpoint URL is required.")
  } else if (!isValidProjectWebhookUrl(url)) {
    errors.push("Enter a valid URL starting with http:// or https://.")
  }

  if (!Array.isArray(input.events) || input.events.length === 0) {
    errors.push("Select at least one event to subscribe to.")
  } else {
    const valid = new Set<string>(PROJECT_WEBHOOK_EVENTS)
    const bad = input.events.filter((event) => !valid.has(event))
    if (bad.length > 0) {
      errors.push(`Unknown event(s): ${bad.join(", ")}.`)
    }
  }

  if (input.secret !== undefined && typeof input.secret !== "string") {
    errors.push("`secret` must be a string.")
  }

  return { ok: errors.length === 0, errors }
}

let idCounter = 0

function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

function upsertProjectWebhook(projectId: string, webhook: ProjectWebhook): boolean {
  const store = loadProjectWebhookStore(projectId)
  const index = store.webhooks.findIndex((item) => item.id === webhook.id)
  if (index >= 0) store.webhooks[index] = webhook
  else store.webhooks.push(webhook)
  return saveProjectWebhookStore(projectId, store)
}

/** Validate + persist a new webhook. Returns the created webhook. */
export function saveNewProjectWebhook(
  projectId: string,
  input: ProjectWebhookInput,
  options: { now?: Date } = {},
): { ok: boolean; webhook?: ProjectWebhook; error?: string; persisted?: boolean } {
  const validation = validateProjectWebhookInput(input)
  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") }
  }
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const webhook: ProjectWebhook = {
    id: nextId("wh"),
    url: input.url.trim(),
    events: [...new Set(input.events)],
    secret: input.secret?.trim() || undefined,
    enabled: input.enabled ?? true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  const persisted = upsertProjectWebhook(projectId, webhook)
  return { ok: true, webhook, persisted }
}

/** Persist an updated webhook (edit, enable/disable toggle). */
export function updateProjectWebhook(projectId: string, webhook: ProjectWebhook): boolean {
  return upsertProjectWebhook(projectId, {
    ...webhook,
    updatedAt: new Date().toISOString(),
  })
}

export function removeProjectWebhook(projectId: string, id: string): boolean {
  const store = loadProjectWebhookStore(projectId)
  const before = store.webhooks.length
  store.webhooks = store.webhooks.filter((item) => item.id !== id)
  // Drop deliveries for the removed endpoint so the log stays consistent.
  store.deliveries = store.deliveries.filter((delivery) => delivery.webhookId !== id)
  if (store.webhooks.length === before) return false
  return saveProjectWebhookStore(projectId, store)
}

/** Toggle a webhook's enabled flag and persist. */
export function setProjectWebhookEnabled(projectId: string, id: string, enabled: boolean): boolean {
  const webhook = getProjectWebhook(projectId, id)
  if (!webhook) return false
  return updateProjectWebhook(projectId, { ...webhook, enabled })
}

export function getProjectWebhook(projectId: string, id: string): ProjectWebhook | null {
  return loadProjectWebhookStore(projectId).webhooks.find((item) => item.id === id) ?? null
}

/** All webhooks for a project, newest first. */
export function listProjectWebhooks(projectId: string): ProjectWebhook[] {
  return [...loadProjectWebhookStore(projectId).webhooks].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

/** Delivery log entries, newest first; optionally filtered to one webhook. */
export function listProjectWebhookDeliveries(
  projectId: string,
  webhookId?: string,
): ProjectWebhookDelivery[] {
  const deliveries = loadProjectWebhookStore(projectId).deliveries
  const filtered = webhookId ? deliveries.filter((d) => d.webhookId === webhookId) : deliveries
  return [...filtered].reverse()
}

/** Remove every delivery-log entry but keep the webhooks. */
export function clearProjectWebhookDeliveries(projectId: string): boolean {
  const store = loadProjectWebhookStore(projectId)
  if (store.deliveries.length === 0) return true
  store.deliveries = []
  return saveProjectWebhookStore(projectId, store)
}

/* ------------------------------------------------------------------------ */
/* Mock test-fire                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Record a MOCK `webhook.test` delivery for a webhook — no HTTP request is
 * sent. The entry lands in the delivery log like a real delivery so the UI
 * can show the pipeline end to end until the dispatcher ships.
 */
export function fireProjectTestWebhook(
  projectId: string,
  webhook: ProjectWebhook,
  options: { now?: Date } = {},
): ProjectWebhookDelivery {
  const now = options.now ?? new Date()
  const delivery: ProjectWebhookDelivery = {
    id: nextId("whd"),
    webhookId: webhook.id,
    event: "webhook.test",
    url: webhook.url,
    status: "success",
    durationMs: 0,
    attemptedAt: now.toISOString(),
    responseSnippet: webhook.secret
      ? "Mock delivery — no request sent. Payload would be signed with the webhook secret."
      : "Mock delivery — no request sent.",
  }

  const store = loadProjectWebhookStore(projectId)
  store.deliveries = [...store.deliveries, delivery].slice(-MAX_PROJECT_WEBHOOK_DELIVERIES)
  saveProjectWebhookStore(projectId, store)
  return delivery
}
