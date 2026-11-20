/**
 * Agent run webhooks — outbound HTTP notifications for run lifecycle events.
 *
 * A webhook subscribes to one or more events (`run.started`,
 * `run.completed`, `run.failed`, `run.cancelled`) and optionally scopes to a
 * single run (`runId` set) or applies globally (`runId` unset). When a run
 * reaches a matching state, `dispatchRunWebhookEvent` POSTs a signed JSON
 * payload to each enabled endpoint and records the outcome in a delivery
 * log (capped, most recent last).
 *
 * Signing follows the repo's Stripe-style convention: when a `secret` is
 * configured the request carries
 * `X-Spindle-Signature: t=<unix>,v1=<hex-hmac-sha256>` over
 * `${t}.${rawBody}` plus `X-Spindle-Event` and `X-Spindle-Delivery` headers.
 * HMAC uses WebCrypto `crypto.subtle` when available with a documented
 * non-cryptographic FNV fallback (same posture as `audit.ts`); tests and
 * custom transports may inject `hmacFn`/`fetchImpl`.
 *
 * Webhooks and the delivery log persist to localStorage
 * (`spindle.agent-runs.webhooks.v1`) via the shared storage helpers; all
 * access is SSR-safe. Delivery is best-effort: a failed POST is recorded,
 * never thrown.
 */

import { storageGetJson, storageSetJson, storageRemove } from "./storage"
import { nextOpsId, runDurationMs, type AgentRunOpsStatus, type AgentRunRecord } from "./types"

export const WEBHOOK_STORAGE_KEY = "spindle.agent-runs.webhooks.v1"
/** Delivery log is capped; oldest entries are dropped first. */
export const MAX_WEBHOOK_DELIVERIES = 200
/** Response body snippets stored on a delivery are truncated to this length. */
export const MAX_RESPONSE_SNIPPET = 200
/** Prompt text included in payloads is truncated to this length. */
export const MAX_PROMPT_PREVIEW = 280

export type AgentRunWebhookEvent = "run.started" | "run.completed" | "run.failed" | "run.cancelled"

export const AGENT_RUN_WEBHOOK_EVENTS: readonly AgentRunWebhookEvent[] = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
]

/** Synthetic event used by the test-fire button; not subscribable. */
export type AgentRunWebhookDeliveryEvent = AgentRunWebhookEvent | "webhook.test"

export interface AgentRunWebhook {
  id: string
  /** Optional human label shown in the UI. */
  name?: string
  /** Endpoint URL — must be absolute http(s). */
  url: string
  /** Subscribed lifecycle events; at least one required. */
  events: AgentRunWebhookEvent[]
  /** Optional HMAC-SHA256 signing secret (never echoed back by UIs). */
  secret?: string
  enabled: boolean
  /** When set, only fires for this run; unset = global. */
  runId?: string
  createdAt: string
  updatedAt: string
}

export type WebhookDeliveryStatus = "success" | "failed"

export interface AgentRunWebhookDelivery {
  id: string
  webhookId: string
  event: AgentRunWebhookDeliveryEvent
  runId?: string
  url: string
  status: WebhookDeliveryStatus
  /** HTTP status code when a response was received. */
  statusCode?: number
  durationMs: number
  attemptedAt: string
  /** Failure reason or transport error message. */
  error?: string
  /** Truncated response body snippet (success or error). */
  responseSnippet?: string
}

export interface AgentRunWebhookStore {
  version: 1
  webhooks: AgentRunWebhook[]
  deliveries: AgentRunWebhookDelivery[]
}

/* ------------------------------------------------------------------------ */
/* Event mapping                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Lifecycle events implied by a run status. `queued`/`waiting_approval` map
 * to nothing — `run.started` fires on `running`.
 */
export function webhookEventsForRunStatus(status: AgentRunOpsStatus): AgentRunWebhookEvent[] {
  switch (status) {
    case "running":
      return ["run.started"]
    case "succeeded":
      return ["run.completed"]
    case "failed":
      return ["run.failed"]
    case "cancelled":
      return ["run.cancelled"]
    case "rejected":
      return ["run.failed"]
    default:
      return []
  }
}

/* ------------------------------------------------------------------------ */
/* Validation + CRUD                                                         */
/* ------------------------------------------------------------------------ */

export interface WebhookInput {
  name?: string
  url: string
  events: AgentRunWebhookEvent[]
  secret?: string
  enabled?: boolean
  runId?: string
}

export interface WebhookValidation {
  ok: boolean
  errors: string[]
}

/** Validate a webhook draft; trims/normalizes nothing (callers persist as-is). */
export function validateWebhookInput(input: WebhookInput): WebhookValidation {
  const errors: string[] = []

  const url = input.url.trim()
  if (!url) {
    errors.push("A webhook URL is required.")
  } else {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        errors.push("Webhook URL must use http or https.")
      }
    } catch {
      errors.push("Webhook URL must be a valid absolute URL.")
    }
  }

  if (!Array.isArray(input.events) || input.events.length === 0) {
    errors.push("At least one event is required.")
  } else {
    const valid = new Set<string>(AGENT_RUN_WEBHOOK_EVENTS)
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

export interface CreateWebhookResult {
  ok: boolean
  webhook?: AgentRunWebhook
  error?: string
}

export function createAgentRunWebhook(
  input: WebhookInput,
  options: { now?: Date } = {},
): CreateWebhookResult {
  const validation = validateWebhookInput(input)
  if (!validation.ok) {
    return { ok: false, error: validation.errors.join(" ") }
  }
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const events = [...new Set(input.events)]
  const webhook: AgentRunWebhook = {
    id: nextOpsId("wh"),
    name: input.name?.trim() || undefined,
    url: input.url.trim(),
    events,
    secret: input.secret?.trim() || undefined,
    enabled: input.enabled ?? true,
    runId: input.runId,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  return { ok: true, webhook }
}

/* ------------------------------------------------------------------------ */
/* Payload + signing                                                         */
/* ------------------------------------------------------------------------ */

export interface AgentRunWebhookData {
  runId: string
  name?: string
  promptPreview: string
  status: AgentRunOpsStatus
  model?: string
  projectId?: string
  projectName?: string
  actor?: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  stepCount: number
  tags: string[]
  metrics: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    costUsd?: number
  }
}

export interface AgentRunWebhookPayload {
  id: string
  event: AgentRunWebhookDeliveryEvent
  createdAt: string
  data: AgentRunWebhookData
}

function promptPreview(prompt: string): string {
  const trimmed = prompt.trim()
  return trimmed.length > MAX_PROMPT_PREVIEW ? `${trimmed.slice(0, MAX_PROMPT_PREVIEW)}…` : trimmed
}

/** Build the JSON payload delivered to a webhook endpoint for a run. */
export function buildWebhookPayload(
  run: AgentRunRecord,
  event: AgentRunWebhookDeliveryEvent,
  options: { now?: Date; deliveryId?: string } = {},
): AgentRunWebhookPayload {
  const now = options.now ?? new Date()
  const durationMs = runDurationMs(run, now.getTime()) ?? undefined
  return {
    id: options.deliveryId ?? nextOpsId("evt"),
    event,
    createdAt: now.toISOString(),
    data: {
      runId: run.id,
      name: run.name,
      promptPreview: promptPreview(run.prompt),
      status: run.status,
      model: run.model ?? run.metrics.model,
      projectId: run.projectId,
      projectName: run.projectName,
      actor: run.actor,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs,
      stepCount: Array.isArray(run.steps) ? run.steps.length : 0,
      tags: Array.isArray(run.tags) ? [...run.tags] : [],
      metrics: {
        inputTokens: run.metrics.inputTokens,
        outputTokens: run.metrics.outputTokens,
        totalTokens: run.metrics.totalTokens,
        costUsd: run.metrics.costUsd,
      },
    },
  }
}

/* ------------------------------------------------------------------------ */
/* HMAC signing (WebCrypto + documented fallback)                            */
/* ------------------------------------------------------------------------ */

/** FNV-1a 64-bit — deterministic, NOT cryptographic (see audit.ts). */
function fnv1a64(input: string): string {
  let h1 = 0xcbf29ce4
  let h2 = 0x8422235
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (code + i), 0x01000193) >>> 0
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const key = await subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const signature = await subtle.sign("HMAC", key, new TextEncoder().encode(data))
    return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("")
  }
  // No WebCrypto (older jsdom/SSR): keyed FNV fallback, documented as
  // non-cryptographic — fine for local dev/test transports.
  return fnv1a64(`hmac:${secret}:${data}`)
}

export type WebhookHmacFn = (secret: string, data: string) => Promise<string> | string

/**
 * Sign `body` Stripe-style: HMAC-SHA256 hex of `${timestampSeconds}.${body}`
 * under `secret`. Returns the `X-Spindle-Signature` header value.
 */
export async function signWebhookBody(
  secret: string,
  body: string,
  options: { timestampSeconds?: number; hmacFn?: WebhookHmacFn } = {},
): Promise<string> {
  const timestampSeconds = options.timestampSeconds ?? Math.floor(Date.now() / 1000)
  const hmacFn = options.hmacFn ?? hmacSha256Hex
  const digest = await hmacFn(secret, `${timestampSeconds}.${body}`)
  return `t=${timestampSeconds},v1=${digest}`
}

/* ------------------------------------------------------------------------ */
/* Delivery                                                                  */
/* ------------------------------------------------------------------------ */

export interface WebhookFetchResponse {
  ok: boolean
  status: number
  text?: () => Promise<string>
}

export type WebhookFetchImpl = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<WebhookFetchResponse>

/** Default transport: global fetch when available, else a sync failure. */
export const defaultWebhookFetch: WebhookFetchImpl = async (url, init) => {
  const fetchFn = globalThis.fetch
  if (typeof fetchFn !== "function") {
    return { ok: false, status: 0 }
  }
  const response = await fetchFn(url, init)
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  }
}

export interface DeliveryOptions {
  fetchImpl?: WebhookFetchImpl
  hmacFn?: WebhookHmacFn
  now?: Date
  /** Inject the payload id (tests); defaults to a fresh ops id. */
  deliveryId?: string
}

function truncateSnippet(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_RESPONSE_SNIPPET
    ? `${trimmed.slice(0, MAX_RESPONSE_SNIPPET)}…`
    : trimmed
}

/**
 * Deliver one payload to a webhook endpoint and return the delivery record.
 * Never throws: transport errors and non-2xx responses become `failed`
 * deliveries with `error`/`statusCode` populated.
 */
export async function deliverRunWebhook(
  webhook: AgentRunWebhook,
  event: AgentRunWebhookDeliveryEvent,
  run: AgentRunRecord,
  options: DeliveryOptions = {},
): Promise<AgentRunWebhookDelivery> {
  const now = options.now ?? new Date()
  const fetchImpl = options.fetchImpl ?? defaultWebhookFetch
  const started = Date.now()

  const payload = buildWebhookPayload(run, event, {
    now,
    deliveryId: options.deliveryId ?? nextOpsId("whd"),
  })
  const body = JSON.stringify(payload)

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "spindle-agent-runs-webhook/1",
    "X-Spindle-Event": event,
    "X-Spindle-Delivery": payload.id,
  }
  if (webhook.secret) {
    headers["X-Spindle-Signature"] = await signWebhookBody(webhook.secret, body, {
      hmacFn: options.hmacFn,
      timestampSeconds: Math.floor(now.getTime() / 1000),
    })
  }

  const base: AgentRunWebhookDelivery = {
    id: payload.id,
    webhookId: webhook.id,
    event,
    runId: run.id,
    url: webhook.url,
    status: "failed",
    durationMs: 0,
    attemptedAt: now.toISOString(),
  }

  try {
    const response = await fetchImpl(webhook.url, { method: "POST", headers, body })
    const durationMs = Date.now() - started
    let responseSnippet: string | undefined
    try {
      const text = await response.text?.()
      if (text) responseSnippet = truncateSnippet(text) || undefined
    } catch {
      // Body unreadable — status alone is still informative.
    }
    if (response.ok) {
      return {
        ...base,
        status: "success",
        statusCode: response.status,
        durationMs,
        responseSnippet,
      }
    }
    return {
      ...base,
      statusCode: response.status,
      durationMs,
      error: `Endpoint returned HTTP ${response.status}.`,
      responseSnippet,
    }
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Webhooks that should fire for `run` + `event`: enabled, subscribed, scoped. */
export function webhooksForRunEvent(
  webhooks: readonly AgentRunWebhook[],
  run: AgentRunRecord,
  event: AgentRunWebhookEvent,
): AgentRunWebhook[] {
  return webhooks.filter(
    (webhook) =>
      webhook.enabled &&
      webhook.events.includes(event) &&
      (webhook.runId === undefined || webhook.runId === run.id),
  )
}

export interface DispatchResult {
  deliveries: AgentRunWebhookDelivery[]
  /** True when the store was persisted (false under SSR/no storage). */
  persisted: boolean
}

/**
 * Fire every matching webhook for a run lifecycle event and append the
 * delivery records to the store. Safe to call for any status — returns an
 * empty result when nothing matches.
 */
export async function dispatchRunWebhookEvent(
  run: AgentRunRecord,
  event: AgentRunWebhookEvent,
  options: DeliveryOptions = {},
): Promise<DispatchResult> {
  const store = loadWebhookStore()
  const targets = webhooksForRunEvent(store.webhooks, run, event)
  if (targets.length === 0) return { deliveries: [], persisted: true }

  const deliveries: AgentRunWebhookDelivery[] = []
  for (const webhook of targets) {
    deliveries.push(await deliverRunWebhook(webhook, event, run, options))
  }
  store.deliveries = [...store.deliveries, ...deliveries].slice(-MAX_WEBHOOK_DELIVERIES)
  return { deliveries, persisted: saveWebhookStore(store) }
}

/**
 * Test-fire a webhook with a synthetic `webhook.test` payload (no run
 * required). The delivery is recorded against the webhook like a real one.
 */
export async function fireTestWebhook(
  webhook: AgentRunWebhook,
  options: DeliveryOptions & { run?: AgentRunRecord } = {},
): Promise<AgentRunWebhookDelivery> {
  const now = options.now ?? new Date()
  const sampleRun: AgentRunRecord =
    options.run ??
    ({
      id: webhook.runId ?? "run_test",
      prompt: "Test webhook delivery — no agent run was executed.",
      status: "succeeded",
      createdAt: now.toISOString(),
      finishedAt: now.toISOString(),
      steps: [],
      events: [],
      metrics: {},
      tags: ["webhook-test"],
    } satisfies AgentRunRecord)

  const delivery = await deliverRunWebhook(webhook, "webhook.test", sampleRun, {
    ...options,
    now,
  })

  const store = loadWebhookStore()
  store.deliveries = [...store.deliveries, delivery].slice(-MAX_WEBHOOK_DELIVERIES)
  saveWebhookStore(store)
  return delivery
}

/* ------------------------------------------------------------------------ */
/* localStorage-backed store                                                 */
/* ------------------------------------------------------------------------ */

export function createWebhookStore(): AgentRunWebhookStore {
  return { version: 1, webhooks: [], deliveries: [] }
}

export function loadWebhookStore(): AgentRunWebhookStore {
  const stored = storageGetJson<Partial<AgentRunWebhookStore>>(WEBHOOK_STORAGE_KEY, {})
  if (stored.version !== 1 || !Array.isArray(stored.webhooks)) return createWebhookStore()
  return {
    version: 1,
    webhooks: stored.webhooks as AgentRunWebhook[],
    deliveries: Array.isArray(stored.deliveries)
      ? (stored.deliveries as AgentRunWebhookDelivery[])
      : [],
  }
}

export function saveWebhookStore(store: AgentRunWebhookStore): boolean {
  return storageSetJson(WEBHOOK_STORAGE_KEY, store)
}

export function clearWebhookStore(): void {
  storageRemove(WEBHOOK_STORAGE_KEY)
}

/** All webhooks, global first then run-scoped, each newest first. */
export function listAgentRunWebhooks(): AgentRunWebhook[] {
  return [...loadWebhookStore().webhooks].sort((a, b) => {
    if ((a.runId === undefined) !== (b.runId === undefined)) {
      return a.runId === undefined ? -1 : 1
    }
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function getAgentRunWebhook(id: string): AgentRunWebhook | null {
  return loadWebhookStore().webhooks.find((w) => w.id === id) ?? null
}

function upsertWebhook(webhook: AgentRunWebhook): boolean {
  const store = loadWebhookStore()
  const index = store.webhooks.findIndex((w) => w.id === webhook.id)
  if (index >= 0) store.webhooks[index] = webhook
  else store.webhooks.push(webhook)
  return saveWebhookStore(store)
}

/** Validate + persist a new webhook. Returns the created webhook. */
export function saveNewAgentRunWebhook(
  input: WebhookInput,
  options: { now?: Date } = {},
): CreateWebhookResult & { persisted?: boolean } {
  const result = createAgentRunWebhook(input, options)
  if (!result.ok || !result.webhook) return result
  const persisted = upsertWebhook(result.webhook)
  return { ...result, persisted }
}

/** Persist an updated webhook (edit, enable/disable toggle). */
export function updateAgentRunWebhook(webhook: AgentRunWebhook): boolean {
  return upsertWebhook({ ...webhook, updatedAt: new Date().toISOString() })
}

export function removeAgentRunWebhook(id: string): boolean {
  const store = loadWebhookStore()
  const before = store.webhooks.length
  store.webhooks = store.webhooks.filter((w) => w.id !== id)
  if (store.webhooks.length === before) return false
  return saveWebhookStore(store)
}

/** Delivery log entries, newest first; optionally filtered to one webhook. */
export function listWebhookDeliveries(webhookId?: string): AgentRunWebhookDelivery[] {
  const deliveries = loadWebhookStore().deliveries
  const filtered = webhookId ? deliveries.filter((d) => d.webhookId === webhookId) : deliveries
  return [...filtered].reverse()
}

/** Toggle a webhook's enabled flag and persist. */
export function setAgentRunWebhookEnabled(id: string, enabled: boolean): boolean {
  const webhook = getAgentRunWebhook(id)
  if (!webhook) return false
  return updateAgentRunWebhook({ ...webhook, enabled })
}
