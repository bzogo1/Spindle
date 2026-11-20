/**
 * Webhook replay engine.
 *
 * Re-delivers previously recorded webhook payloads (JSONL exports from the
 * DLQ, receiver logs, or `/_deliveries` dumps) to a webhook endpoint.
 *
 * Design notes:
 *  - The module is transport-agnostic: it accepts an injected `fetchImpl`
 *    (defaults to global `fetch`) and a `signer` callback, so it runs in the
 *    Next.js runtime, vitest, and plain Node (type-stripped) alike.
 *  - Signing is intentionally NOT implemented here — the contract signing
 *    module (`scripts/webhooks/contract/signing.ts`) owns HMAC details; the
 *    CLI wires it in. This keeps `src/lib` free of `node:crypto`.
 *  - Only erasable TypeScript syntax is used so Node's native type
 *    stripping can import this file directly from `scripts/webhooks/replay/replay.mjs`.
 */

/** How the Idempotency-Key is chosen for each replayed delivery. */
export type IdempotencyKeyMode =
  /** Reuse the key recorded with the original delivery (true replay). */
  | "original"
  /** Mint a fresh key per delivery so receivers treat it as a new event. */
  | "new"

/** Delivery pacing. */
export type ReplayOrder =
  /** Await each delivery before starting the next (file order preserved). */
  | "sequential"
  /** Bounded worker pool; result order still matches input order. */
  | "parallel"

/** Sort applied to records before replaying. */
export type ReplaySort = "none" | "recordedAt"

/**
 * One line of a webhook replay JSONL file. `rawBody` is the exact bytes the
 * receiver originally saw; `payload`/`eventId`/`idempotencyKey` are optional
 * convenience fields used when `rawBody` is absent or for reporting.
 */
export interface StoredWebhookRecord {
  /** Exact serialized request body. Preferred — replay sends it verbatim. */
  rawBody?: string
  /** Alias for `rawBody` accepted by some exporters. */
  body?: string
  /** Parsed payload object; serialized when `rawBody`/`body` are absent. */
  payload?: unknown
  /** Headers recorded with the original delivery (lowercase names). */
  headers?: Record<string, string>
  /** Endpoint the delivery was originally sent to (or should go to). */
  endpoint?: string
  /** ISO-8601 time the delivery was originally recorded. */
  recordedAt?: string
  /** Event id (`evt_…`) for reporting; falls back to `payload.id`. */
  eventId?: string
  /** Idempotency key for reporting; falls back to `payload.idempotencyKey`. */
  idempotencyKey?: string
  /** Event type for reporting; falls back to `payload.type`. */
  type?: string
  /** Free-form provenance (e.g. "dlq", "receiver-log", "manual"). */
  source?: string
}

export interface PreparedDelivery {
  endpoint: string
  rawBody: string
  headers: Record<string, string>
  eventId?: string
  idempotencyKey?: string
  eventType?: string
  /** Non-fatal anomalies worth surfacing in reports (e.g. unsigned body). */
  warnings: string[]
}

export type ReplayStatus = "delivered" | "duplicate" | "failed" | "skipped" | "dry-run"

export interface ReplayResult {
  /** Position in the (possibly sorted) input list. */
  index: number
  eventId?: string
  idempotencyKey?: string
  eventType?: string
  endpoint?: string
  status: ReplayStatus
  httpStatus?: number
  /** `true` when the receiver reported the delivery as a duplicate. */
  duplicate?: boolean
  /** Number of HTTP attempts made (0 for dry-run/skipped). */
  attempts: number
  durationMs: number
  error?: string
}

/** Returns signature headers to merge for a given raw body. */
export type WebhookSigner = (rawBody: string) => Record<string, string>

export interface ReplayOptions {
  /** Override endpoint for all records that don't carry their own. */
  endpoint?: string
  /** Idempotency-Key strategy. Default: `"original"`. */
  idempotency?: IdempotencyKeyMode
  /**
   * Optional signer producing extra headers (e.g. `webhook-signature`).
   * Called AFTER idempotency rewriting so signatures cover final bytes.
   */
  signer?: WebhookSigner
  /** Factory for fresh keys in `"new"` mode; injectable for tests. */
  newIdempotencyKey?: () => string
  /** Delivery pacing. Default: `"sequential"`. */
  order?: ReplayOrder
  /** Worker count for `order: "parallel"`. Default: 4. */
  concurrency?: number
  /** Sort records by `recordedAt` before replaying. Default: `"none"`. */
  sort?: ReplaySort
  /** Delay between deliveries (per worker). Default: 0. */
  delayMs?: number
  /** Per-request timeout. Default: 30_000 ms. */
  timeoutMs?: number
  /** Extra attempts on network errors and 5xx responses. Default: 0. */
  retries?: number
  /** Compute everything but never send. Default: false. */
  dryRun?: boolean
  /** fetch implementation; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Called after each delivery resolves. */
  onProgress?: (result: ReplayResult, index: number, total: number) => void
  /** Clock override for tests. */
  now?: () => number
}

export interface JsonlParseResult {
  records: StoredWebhookRecord[]
  /** Line-level failures; valid lines are still returned. */
  errors: { line: number; message: string }[]
}

function defaultNewIdempotencyKey(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18)
  return `idem_replay_${Date.now().toString(36)}_${rand}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parses webhook replay JSONL. Blank lines are ignored; malformed lines are
 * collected into `errors` (1-based line numbers) without aborting the parse.
 */
export function parseReplayJsonl(input: string): JsonlParseResult {
  const records: StoredWebhookRecord[] = []
  const errors: { line: number; message: string }[] = []

  input.split("\n").forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push({ line: i + 1, message: "line is not a JSON object" })
        return
      }
      records.push(parsed as StoredWebhookRecord)
    } catch (err) {
      errors.push({ line: i + 1, message: err instanceof Error ? err.message : "invalid JSON" })
    }
  })

  return { records, errors }
}

interface BodyInfo {
  id?: string
  type?: string
  idempotencyKey?: string
  /** Parsed body when it is a JSON object, else undefined. */
  object?: Record<string, unknown>
}

function inspectBody(rawBody: string): BodyInfo {
  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const obj = parsed as Record<string, unknown>
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
    return {
      id: str(obj.id),
      type: str(obj.type),
      idempotencyKey: str(obj.idempotencyKey),
      object: obj,
    }
  } catch {
    return {}
  }
}

export type PrepareResult = { ok: true; delivery: PreparedDelivery } | { ok: false; error: string }

/**
 * Resolves endpoint, raw body, and headers for one stored record, applying
 * the idempotency-key mode. Pure — performs no I/O.
 */
export function prepareDelivery(
  record: StoredWebhookRecord,
  options: Pick<ReplayOptions, "endpoint" | "idempotency" | "signer" | "newIdempotencyKey"> = {},
): PrepareResult {
  const warnings: string[] = []

  const endpoint = options.endpoint ?? record.endpoint
  if (!endpoint) {
    return { ok: false, error: "missing_endpoint" }
  }

  let rawBody = record.rawBody ?? record.body
  if (rawBody === undefined && record.payload !== undefined) {
    try {
      rawBody = JSON.stringify(record.payload)
    } catch {
      return { ok: false, error: "payload_not_serializable" }
    }
  }
  if (typeof rawBody !== "string" || rawBody.length === 0) {
    return { ok: false, error: "missing_body" }
  }

  const info = inspectBody(rawBody)
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(record.headers ?? {}),
  }

  // Keep transport headers consistent with the payload.
  const eventId = record.eventId ?? info.id
  if (eventId && !headers["webhook-id"]) {
    headers["webhook-id"] = eventId
  }

  const mode = options.idempotency ?? "original"
  let idempotencyKey = headers["idempotency-key"] ?? record.idempotencyKey ?? info.idempotencyKey

  if (mode === "new") {
    const keyFactory = options.newIdempotencyKey ?? defaultNewIdempotencyKey
    const newKey = keyFactory()
    if (info.object) {
      info.object.idempotencyKey = newKey
      try {
        rawBody = JSON.stringify(info.object)
        headers["idempotency-key"] = newKey
        idempotencyKey = newKey
      } catch {
        warnings.push("body_rewrite_failed_idempotency_key_unchanged")
      }
    } else {
      // Body is not a JSON object — can't safely rewrite the embedded key.
      warnings.push("body_not_json_idempotency_key_unchanged")
    }
  } else if (idempotencyKey) {
    headers["idempotency-key"] = idempotencyKey
  }

  // Sign last so the signature covers the final bytes.
  if (options.signer) {
    Object.assign(headers, options.signer(rawBody))
  }

  return {
    ok: true,
    delivery: {
      endpoint,
      rawBody,
      headers,
      eventId,
      idempotencyKey,
      eventType: record.type ?? info.type,
      warnings,
    },
  }
}

interface SendResponse {
  ok: boolean
  status: number
  duplicate: boolean
  bodySnippet: string
}

async function sendOnce(
  delivery: PreparedDelivery,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SendResponse> {
  const response = await fetchImpl(delivery.endpoint, {
    method: "POST",
    headers: delivery.headers,
    body: delivery.rawBody,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let duplicate = false
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).duplicate === true
    ) {
      duplicate = true
    }
  } catch {
    // Non-JSON response bodies are fine; status still decides.
  }
  return {
    ok: response.ok,
    status: response.status,
    duplicate,
    bodySnippet: text.slice(0, 300),
  }
}

async function deliverWithRetries(
  delivery: PreparedDelivery,
  options: Required<Pick<ReplayOptions, "retries" | "timeoutMs" | "delayMs">> & {
    fetchImpl: typeof fetch
    now: () => number
  },
): Promise<{
  status: ReplayStatus
  httpStatus?: number
  duplicate?: boolean
  attempts: number
  durationMs: number
  error?: string
}> {
  const started = options.now()
  const maxAttempts = options.retries + 1
  let lastError: string | undefined
  let lastHttpStatus: number | undefined
  let lastDuplicate = false

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && options.delayMs > 0) {
      await sleep(options.delayMs * attempt)
    }
    try {
      const res = await sendOnce(delivery, options.fetchImpl, options.timeoutMs)
      lastHttpStatus = res.status
      lastDuplicate = res.duplicate
      if (res.ok) {
        return {
          status: res.duplicate ? "duplicate" : "delivered",
          httpStatus: res.status,
          duplicate: res.duplicate,
          attempts: attempt,
          durationMs: options.now() - started,
        }
      }
      lastError = `http_${res.status}${res.bodySnippet ? `: ${res.bodySnippet}` : ""}`
      // Retry only on server errors; 4xx won't heal by retrying.
      if (res.status < 500) {
        return {
          status: "failed",
          httpStatus: res.status,
          attempts: attempt,
          durationMs: options.now() - started,
          error: lastError,
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    status: "failed",
    httpStatus: lastHttpStatus,
    duplicate: lastDuplicate || undefined,
    attempts: maxAttempts,
    durationMs: options.now() - started,
    error: lastError ?? "unknown_error",
  }
}

function sortRecords(records: StoredWebhookRecord[], sort: ReplaySort): StoredWebhookRecord[] {
  if (sort !== "recordedAt") return records
  // Stable sort: records without recordedAt keep their relative order at the end.
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const at = a.record.recordedAt ?? ""
      const bt = b.record.recordedAt ?? ""
      if (at === bt) return a.index - b.index
      if (at === "") return 1
      if (bt === "") return -1
      return at < bt ? -1 : 1
    })
    .map(({ record }) => record)
}

/**
 * Replays stored webhook records against their endpoints.
 *
 * - `dryRun: true` prepares every delivery (endpoint resolution, idempotency
 *   rewrite, signing) but never calls fetch; results carry status `"dry-run"`.
 * - `order: "parallel"` uses a worker pool of `concurrency`; results are
 *   returned in input order regardless of completion order.
 * - Records that fail preparation are reported as `"skipped"` and do not
 *   abort the batch.
 */
export async function replayDeliveries(
  records: StoredWebhookRecord[],
  options: ReplayOptions = {},
): Promise<ReplayResult[]> {
  const sorted = sortRecords(records, options.sort ?? "none")
  const total = sorted.length
  const results: ReplayResult[] = new Array(total)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => Date.now())
  const delayMs = options.delayMs ?? 0
  const timeoutMs = options.timeoutMs ?? 30_000
  const retries = options.retries ?? 0
  const dryRun = options.dryRun ?? false

  interface WorkItem {
    index: number
    delivery: PreparedDelivery
  }
  const queue: WorkItem[] = []

  sorted.forEach((record, index) => {
    const prepared = prepareDelivery(record, options)
    if (!prepared.ok) {
      results[index] = {
        index,
        status: "skipped",
        attempts: 0,
        durationMs: 0,
        error: prepared.error,
      }
      options.onProgress?.(results[index], index, total)
      return
    }
    if (dryRun) {
      results[index] = {
        index,
        eventId: prepared.delivery.eventId,
        idempotencyKey: prepared.delivery.idempotencyKey,
        eventType: prepared.delivery.eventType,
        endpoint: prepared.delivery.endpoint,
        status: "dry-run",
        attempts: 0,
        durationMs: 0,
      }
      options.onProgress?.(results[index], index, total)
      return
    }
    queue.push({ index, delivery: prepared.delivery })
  })

  const runOne = async (item: WorkItem): Promise<ReplayResult> => {
    const outcome = await deliverWithRetries(item.delivery, {
      fetchImpl,
      now,
      retries,
      timeoutMs,
      delayMs,
    })
    const result: ReplayResult = {
      index: item.index,
      eventId: item.delivery.eventId,
      idempotencyKey: item.delivery.idempotencyKey,
      eventType: item.delivery.eventType,
      endpoint: item.delivery.endpoint,
      ...outcome,
    }
    options.onProgress?.(result, item.index, total)
    return result
  }

  if (options.order === "parallel") {
    const concurrency = Math.max(1, options.concurrency ?? 4)
    let cursor = 0
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const item = queue[cursor]
        cursor += 1
        if (!item) break
        if (delayMs > 0) await sleep(delayMs)
        results[item.index] = await runOne(item)
      }
    })
    await Promise.all(workers)
  } else {
    for (const item of queue) {
      if (delayMs > 0) await sleep(delayMs)
      results[item.index] = await runOne(item)
    }
  }

  return results
}

/** Convenience: parse JSONL text then replay in one call. */
export async function replayJsonl(
  input: string,
  options: ReplayOptions & { onParseErrors?: (errors: JsonlParseResult["errors"]) => void } = {},
): Promise<{ results: ReplayResult[]; parseErrors: JsonlParseResult["errors"] }> {
  const { records, errors } = parseReplayJsonl(input)
  if (errors.length > 0) options.onParseErrors?.(errors)
  const results = await replayDeliveries(records, options)
  return { results, parseErrors: errors }
}

/** Summary counts for reports. */
export function summarizeReplayResults(results: ReplayResult[]): Record<ReplayStatus, number> {
  const summary: Record<ReplayStatus, number> = {
    delivered: 0,
    duplicate: 0,
    failed: 0,
    skipped: 0,
    "dry-run": 0,
  }
  for (const result of results) {
    summary[result.status] += 1
  }
  return summary
}
