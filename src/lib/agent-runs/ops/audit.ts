/**
 * Agent run audit trail — append-only, tamper-evident log of run lifecycle
 * events.
 *
 * Each `AuditEntry` carries `prevHash` (the previous entry's hash, or
 * "GENESIS" for the first) and `hash` = sha256 over its canonical fields plus
 * `prevHash`. `verifyAuditChain` recomputes the chain and reports the first
 * broken link. Hashing uses WebCrypto `crypto.subtle` when available and a
 * documented FNV-1a fallback otherwise; callers may inject their own `hashFn`.
 *
 * Logs persist to localStorage (`spindle.agent-runs.audit.v1`) via the shared
 * storage helpers; all access is SSR-safe.
 */

import { storageGetJson, storageSetJson } from "./storage"
import type { AgentRunRecord } from "./types"

export const AUDIT_STORAGE_KEY = "spindle.agent-runs.audit.v1"
export const AUDIT_GENESIS_HASH = "GENESIS"

export type AuditEventType =
  | "run.created"
  | "run.started"
  | "run.checkpointed"
  | "run.finished"
  | "run.shared"
  | "run.exported"
  | "run.imported"
  | "run.deleted"
  | "policy.evaluated"
  | "security.scanned"
  | "custom"

export interface AuditEntry {
  /** Monotonic sequence number within the log (1-based). */
  seq: number
  /** ISO-8601 timestamp. */
  at: string
  type: AuditEventType
  runId: string
  actor?: string
  /** Free-form structured detail (kept small — audit, not payload store). */
  detail?: Record<string, unknown>
  prevHash: string
  hash: string
}

export interface RunAuditLog {
  version: 1
  entries: AuditEntry[]
}

export type AuditHashFn = (input: string) => Promise<string> | string

/** FNV-1a 64-bit fallback — deterministic, NOT cryptographic. */
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

async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const bytes = new TextEncoder().encode(input)
    const digest = await subtle.digest("SHA-256", bytes)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
  }
  return fnv1a64(input)
}

/** Default hash: SHA-256 via WebCrypto with FNV-1a fallback. */
export const defaultAuditHash: AuditHashFn = sha256Hex

/** Canonical serialization of the hashed fields — stable key order. */
export function auditEntryPayload(entry: Omit<AuditEntry, "hash">): string {
  return JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    type: entry.type,
    runId: entry.runId,
    actor: entry.actor ?? null,
    detail: entry.detail ?? null,
    prevHash: entry.prevHash,
  })
}

export function createAuditLog(): RunAuditLog {
  return { version: 1, entries: [] }
}

export interface AppendAuditInput {
  type: AuditEventType
  runId: string
  actor?: string
  detail?: Record<string, unknown>
  /** Override timestamp (defaults to now). */
  at?: Date
}

/**
 * Append an entry to the log (mutates `log.entries` — the log is
 * append-only by contract; never edit or reorder existing entries).
 * Returns the appended entry.
 */
export async function appendAuditEvent(
  log: RunAuditLog,
  input: AppendAuditInput,
  options: { hashFn?: AuditHashFn } = {},
): Promise<AuditEntry> {
  const hashFn = options.hashFn ?? defaultAuditHash
  const prev = log.entries[log.entries.length - 1]
  const base: Omit<AuditEntry, "hash"> = {
    seq: log.entries.length + 1,
    at: (input.at ?? new Date()).toISOString(),
    type: input.type,
    runId: input.runId,
    actor: input.actor,
    detail: input.detail,
    prevHash: prev ? prev.hash : AUDIT_GENESIS_HASH,
  }
  const entry: AuditEntry = { ...base, hash: await hashFn(auditEntryPayload(base)) }
  log.entries.push(entry)
  return entry
}

export interface AuditVerification {
  ok: boolean
  entriesChecked: number
  /** seq of the first entry whose hash or prevHash link is broken. */
  brokenAt?: number
  reason?: string
}

/**
 * Recompute the whole chain; `ok` only when every link verifies.
 *
 * Also enforces `seq === position + 1`, catching middle deletions that would
 * otherwise leave a self-consistent shorter chain.
 *
 * Caveat: this detects corruption and naive tampering, not a determined
 * attacker — someone with write access can recompute hashes for a forged
 * suffix, and truncating the *tail* of the log leaves a valid shorter chain
 * (the last remaining entry's hash still verifies). Treat `ok` as "no
 * detected inconsistency", and keep an external copy (backup export) as the
 * real tamper anchor.
 */
export async function verifyAuditChain(
  log: RunAuditLog,
  options: { hashFn?: AuditHashFn } = {},
): Promise<AuditVerification> {
  const hashFn = options.hashFn ?? defaultAuditHash
  let prevHash = AUDIT_GENESIS_HASH
  for (let i = 0; i < log.entries.length; i += 1) {
    const entry = log.entries[i]
    if (entry.seq !== i + 1) {
      return {
        ok: false,
        entriesChecked: i,
        brokenAt: entry.seq,
        reason: `seq gap: expected ${i + 1}, found ${entry.seq}`,
      }
    }
    const { hash, ...base } = entry
    if (entry.prevHash !== prevHash) {
      return {
        ok: false,
        entriesChecked: entry.seq - 1,
        brokenAt: entry.seq,
        reason: "prevHash mismatch",
      }
    }
    const expected = await hashFn(auditEntryPayload(base))
    if (expected !== hash) {
      return {
        ok: false,
        entriesChecked: entry.seq - 1,
        brokenAt: entry.seq,
        reason: "hash mismatch",
      }
    }
    prevHash = hash
  }
  return { ok: true, entriesChecked: log.entries.length }
}

/* ------------------------------------------------------------------------ */
/* Lifecycle helpers + persistence                                           */
/* ------------------------------------------------------------------------ */

/**
 * Record the lifecycle implied by a run's timestamps: created → started →
 * finished (when terminal). Useful for backfilling an audit trail from an
 * imported run. Appends in chronological order.
 */
export async function recordRunLifecycleEvents(
  log: RunAuditLog,
  run: AgentRunRecord,
  options: { hashFn?: AuditHashFn; actor?: string } = {},
): Promise<AuditEntry[]> {
  const appended: AuditEntry[] = []
  appended.push(
    await appendAuditEvent(
      log,
      {
        type: "run.created",
        runId: run.id,
        actor: options.actor ?? run.actor,
        at: new Date(run.createdAt),
        detail: { status: run.status, templateId: run.templateId },
      },
      options,
    ),
  )
  if (run.startedAt) {
    appended.push(
      await appendAuditEvent(
        log,
        {
          type: "run.started",
          runId: run.id,
          actor: options.actor ?? run.actor,
          at: new Date(run.startedAt),
          detail: { status: run.status },
        },
        options,
      ),
    )
  }
  if (run.finishedAt) {
    appended.push(
      await appendAuditEvent(
        log,
        {
          type: "run.finished",
          runId: run.id,
          actor: options.actor ?? run.actor,
          at: new Date(run.finishedAt),
          detail: { status: run.status },
        },
        options,
      ),
    )
  }
  return appended
}

export function saveAuditLog(log: RunAuditLog): boolean {
  return storageSetJson(AUDIT_STORAGE_KEY, log)
}

export function loadAuditLog(): RunAuditLog {
  const stored = storageGetJson<Partial<RunAuditLog>>(AUDIT_STORAGE_KEY, {})
  if (stored.version !== 1 || !Array.isArray(stored.entries)) return createAuditLog()
  return { version: 1, entries: stored.entries as AuditEntry[] }
}

export function clearAuditLog(): void {
  saveAuditLog(createAuditLog())
}

/** Entries for one run, newest last. */
export function auditEntriesForRun(log: RunAuditLog, runId: string): AuditEntry[] {
  return log.entries.filter((entry) => entry.runId === runId)
}
