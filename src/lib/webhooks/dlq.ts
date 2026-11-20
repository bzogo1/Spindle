/**
 * Webhook dead-letter queue (DLQ).
 *
 * When outbound webhook delivery exhausts its retry budget, the failed
 * delivery is recorded here instead of being dropped. Each DLQ entry keeps
 * everything needed to replay the delivery later: the target URL, the exact
 * raw request body, and the delivery headers (including the signature that
 * was computed at failure time — replay reuses it verbatim, so receivers see
 * the same signed payload they would have seen originally).
 *
 * Storage is pluggable behind {@link WebhookDlqStore}:
 *
 * - {@link createMemoryDlqStore} — in-process store for tests and demo runs.
 * - {@link createJsonlDlqStore} — append-mostly JSONL file store for
 *   single-node deployments and the `scripts/webhooks/dlq/manage.mjs` CLI.
 *
 * Retention policy and alerting live in `docs/webhooks/dead-letter-queue.md`.
 * This module deliberately knows nothing about the delivery pipeline: the
 * caller (retry/monitoring workstream) invokes {@link createWebhookDlq}'s
 * `deadLetter` once retries are exhausted, and `replay`/`replayAll` accept an
 * injected deliver function so the DLQ stays decoupled from HTTP details.
 */

import { randomBytes } from "node:crypto"
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** A single failed webhook delivery parked in the dead-letter queue. */
export type WebhookDlqEntry = {
  /** Unique DLQ record id, e.g. `dlq_<timestamp>_<random>`. */
  id: string
  /** Webhook endpoint/subscription id that failed, when known. */
  endpointId?: string
  /** Provider/event id the delivery carried (dedup + inspection aid). */
  eventId?: string
  /** Target delivery URL the retry loop was POSTing to. */
  url: string
  /** Raw request body exactly as it would be delivered on the wire. */
  rawBody: string
  /**
   * Delivery headers as they were (or would be) sent —
   * `webhook-id`, `webhook-signature`, `content-type`, `idempotency-key`, …
   * Replay reuses these verbatim.
   */
  headers?: Record<string, string>
  /** Attempts made by the primary retry loop before dead-lettering. */
  attempts: number
  /** Cumulative replay attempts made from the DLQ itself. */
  replayAttempts: number
  /** Last failure captured when the entry was dead-lettered. */
  lastError?: string
  /** HTTP status of the last failed delivery, when one was received. */
  lastStatus?: number
  /** ISO-8601 timestamp when the entry was dead-lettered. */
  deadLetteredAt: string
  /** ISO-8601 timestamp of the most recent replay attempt. */
  lastReplayAt?: string
  /** Outcome of the most recent replay attempt. */
  lastReplayOk?: boolean
  /** Free-form reason tag, e.g. `"max-attempts"`, `"timeout"`, `"5xx-storm"`. */
  reason?: string
  /** Optional operator notes (who/why removed or replayed). */
  notes?: string
}

/** Fields the caller supplies when dead-lettering a failed delivery. */
export type DeadLetterInput = Omit<
  WebhookDlqEntry,
  "id" | "deadLetteredAt" | "replayAttempts" | "lastReplayAt" | "lastReplayOk" | "notes"
> & {
  /** Injected clock override; defaults to `new Date()`. */
  deadLetteredAt?: string
}

/**
 * Persistence contract for DLQ entries. Implementations must tolerate
 * concurrent appends from a single process; cross-process writers should use
 * {@link createJsonlDlqStore} with one file per deployment node.
 */
export interface WebhookDlqStore {
  /** Persist a new entry (append semantics; id must be unique). */
  append(entry: WebhookDlqEntry): Promise<void>
  /** Return all entries, oldest first. */
  list(): Promise<WebhookDlqEntry[]>
  /** Return a single entry by id, or `null` when absent. */
  get(id: string): Promise<WebhookDlqEntry | null>
  /** Replace an existing entry in place. Returns false when id is absent. */
  update(entry: WebhookDlqEntry): Promise<boolean>
  /** Remove an entry by id. Returns true when something was removed. */
  remove(id: string): Promise<boolean>
}

/** Result of replaying one DLQ entry through an injected deliver function. */
export type ReplayResult =
  | { status: "replayed"; id: string }
  | { status: "failed"; id: string; error: string; entry: WebhookDlqEntry }
  | { status: "missing"; id: string }

/** Aggregate outcome of {@link WebhookDlq.replayAll}. */
export type ReplaySummary = {
  attempted: number
  replayed: number
  failed: number
  results: ReplayResult[]
}

/** Outcome reported by an injected deliver function for one DLQ entry. */
export type DeliverOutcome =
  { ok: true; status?: number } | { ok: false; status?: number; error: string }

/** Injected delivery function used by replay. Maps a DLQ entry to an HTTP outcome. */
export type WebhookDeliverFn = (entry: WebhookDlqEntry) => Promise<DeliverOutcome>

export type WebhookDlqOptions = {
  store: WebhookDlqStore
  /** Id generator; defaults to `dlq_<base36-timestamp>_<random-hex>`. */
  idGenerator?: () => string
}

export type PruneOptions = {
  /** Remove entries dead-lettered before this many ms ago. */
  olderThanMs?: number
  /** Absolute cutoff (ISO-8601 or epoch ms) — alternative to `olderThanMs`. */
  before?: string | number
  /** Hard cap: keep only the newest N entries regardless of age. */
  keepLatest?: number
}

export type WebhookDlq = {
  /** Record a delivery that exhausted retries. Returns the stored entry. */
  deadLetter(input: DeadLetterInput): Promise<WebhookDlqEntry>
  /** List all DLQ entries, oldest first. */
  list(): Promise<WebhookDlqEntry[]>
  /** Fetch one entry by id. */
  inspect(id: string): Promise<WebhookDlqEntry | null>
  /**
   * Replay one entry through `deliver`. On success the entry is removed from
   * the queue; on failure it stays with updated replay bookkeeping.
   */
  replay(id: string, deliver: WebhookDeliverFn): Promise<ReplayResult>
  /** Replay up to `limit` entries (oldest first). Default: all entries. */
  replayAll(deliver: WebhookDeliverFn, options?: { limit?: number }): Promise<ReplaySummary>
  /** Remove an entry (e.g. acknowledged as unrecoverable). */
  remove(id: string): Promise<boolean>
  /** Apply retention rules; returns number of entries removed. */
  prune(options: PruneOptions): Promise<number>
}

function defaultIdGenerator(): string {
  const stamp = Date.now().toString(36)
  const rand = randomBytes(4).toString("hex")
  return `dlq_${stamp}_${rand}`
}

/**
 * Build a DLQ manager over a store. See {@link WebhookDlq} for the API.
 */
export function createWebhookDlq({
  store,
  idGenerator = defaultIdGenerator,
}: WebhookDlqOptions): WebhookDlq {
  async function replay(id: string, deliver: WebhookDeliverFn): Promise<ReplayResult> {
    const entry = await store.get(id)
    if (!entry) return { status: "missing", id }

    let outcome: DeliverOutcome
    try {
      outcome = await deliver(entry)
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const replayed: WebhookDlqEntry = {
      ...entry,
      replayAttempts: entry.replayAttempts + 1,
      lastReplayAt: new Date().toISOString(),
      lastReplayOk: outcome.ok,
      lastError: outcome.ok ? entry.lastError : outcome.error,
      lastStatus: outcome.status ?? entry.lastStatus,
    }

    if (outcome.ok) {
      await store.remove(id)
      return { status: "replayed", id }
    }

    await store.update(replayed)
    return { status: "failed", id, error: outcome.error, entry: replayed }
  }

  return {
    async deadLetter(input) {
      const { deadLetteredAt, ...rest } = input
      const entry: WebhookDlqEntry = {
        ...rest,
        id: idGenerator(),
        replayAttempts: 0,
        deadLetteredAt: deadLetteredAt ?? new Date().toISOString(),
      }
      await store.append(entry)
      return entry
    },

    list: () => store.list(),
    inspect: (id) => store.get(id),

    replay,

    async replayAll(deliver, options = {}) {
      const all = await store.list()
      const targets = options.limit !== undefined ? all.slice(0, options.limit) : all
      const results: ReplayResult[] = []
      for (const target of targets) {
        // Entries may be removed by an earlier replay in this loop; `replay`
        // reports "missing" for those, which is filtered out below.
        results.push(await replay(target.id, deliver))
      }
      const counted = results.filter((r) => r.status !== "missing")
      return {
        attempted: counted.length,
        replayed: counted.filter((r) => r.status === "replayed").length,
        failed: counted.filter((r) => r.status === "failed").length,
        results,
      }
    },

    remove: (id) => store.remove(id),

    async prune({ olderThanMs, before, keepLatest }) {
      const all = await store.list()
      const cutoffMs =
        before !== undefined
          ? typeof before === "number"
            ? before
            : Date.parse(before)
          : olderThanMs !== undefined
            ? Date.now() - olderThanMs
            : undefined

      const expired = new Set<string>()
      if (cutoffMs !== undefined && !Number.isNaN(cutoffMs)) {
        for (const entry of all) {
          const ts = Date.parse(entry.deadLetteredAt)
          if (!Number.isNaN(ts) && ts < cutoffMs) expired.add(entry.id)
        }
      }
      if (keepLatest !== undefined && keepLatest >= 0 && all.length > keepLatest) {
        for (const entry of all.slice(0, all.length - keepLatest)) expired.add(entry.id)
      }

      let removed = 0
      for (const id of expired) {
        if (await store.remove(id)) removed += 1
      }
      return removed
    },
  }
}

/* ------------------------------------------------------------------ */
/* Store implementations                                                */
/* ------------------------------------------------------------------ */

/** In-memory store — tests, demos, and short-lived processes. */
export function createMemoryDlqStore(): WebhookDlqStore {
  const entries = new Map<string, WebhookDlqEntry>()
  return {
    async append(entry) {
      entries.set(entry.id, entry)
    },
    async list() {
      return [...entries.values()]
    },
    async get(id) {
      return entries.get(id) ?? null
    },
    async update(entry) {
      if (!entries.has(entry.id)) return false
      entries.set(entry.id, entry)
      return true
    },
    async remove(id) {
      return entries.delete(id)
    },
  }
}

/**
 * JSONL file store — one JSON-encoded {@link WebhookDlqEntry} per line.
 *
 * Append is a single `appendFile` (atomic enough for line-oriented JSONL at
 * webhook volumes). `update`/`remove` rewrite the whole file via
 * write-temp-then-rename so readers never observe a torn file.
 *
 * Unparseable lines are skipped on read and dropped on the next rewrite;
 * they are counted in `skippedLines` for observability. Do not hand-edit the
 * file while the process is running.
 */
export function createJsonlDlqStore(path: string): WebhookDlqStore & {
  path: string
  skippedLines: () => number
} {
  let skipped = 0

  async function readAll(): Promise<WebhookDlqEntry[]> {
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const entries: WebhookDlqEntry[] = []
    let localSkipped = 0
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as WebhookDlqEntry
        if (typeof parsed?.id === "string") entries.push(parsed)
        else localSkipped += 1
      } catch {
        localSkipped += 1
      }
    }
    skipped += localSkipped
    return entries
  }

  async function writeAll(entries: WebhookDlqEntry[]): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${process.pid}`
    const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "")
    await writeFile(tmp, body, "utf8")
    await rename(tmp, path)
  }

  return {
    path,
    skippedLines: () => skipped,

    async append(entry) {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, JSON.stringify(entry) + "\n", "utf8")
    },

    list: readAll,

    async get(id) {
      const entries = await readAll()
      return entries.find((e) => e.id === id) ?? null
    },

    async update(entry) {
      const entries = await readAll()
      const idx = entries.findIndex((e) => e.id === entry.id)
      if (idx === -1) return false
      entries[idx] = entry
      await writeAll(entries)
      return true
    },

    async remove(id) {
      const entries = await readAll()
      const next = entries.filter((e) => e.id !== id)
      if (next.length === entries.length) return false
      await writeAll(next)
      return true
    },
  }
}
