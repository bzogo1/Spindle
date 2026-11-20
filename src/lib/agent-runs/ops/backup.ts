/**
 * Agent run backup — export/import of recorded runs.
 *
 * `buildRunBackup` wraps one or more runs in a versioned document with a
 * manifest (counts, ids, creation time). `serializeRunBackup` /
 * `parseRunBackup` handle the wire format; `downloadRunBackup` triggers a
 * browser file download (no-op outside the browser). `saveRunsAutoBackup` /
 * `loadRunsAutoBackup` maintain a localStorage snapshot for quick restore.
 */

import { storageGetJson, storageSetJson, storageRemove } from "./storage"
import { normalizeAgentRunRecord, type AgentRunRecord } from "./types"

export const RUN_BACKUP_VERSION = 1
export const AUTO_BACKUP_STORAGE_KEY = "spindle.agent-runs.autobackup.v1"
/** Cap auto-backup size so localStorage quota is not blown on huge run sets. */
export const AUTO_BACKUP_MAX_RUNS = 100

export interface BackupManifest {
  version: number
  app: "spindle"
  kind: "agent-run-backup"
  createdAt: string
  runCount: number
  runIds: string[]
  /** Whether runs include steps/events (always true for v1, kept for forward-compat). */
  includesSteps: boolean
  includesEvents: boolean
}

export interface RunBackupDocument {
  manifest: BackupManifest
  runs: AgentRunRecord[]
}

export interface AutoBackupSnapshot {
  version: 1
  savedAt: string
  runs: AgentRunRecord[]
}

export function buildBackupManifest(
  runs: readonly AgentRunRecord[],
  options: { now?: Date } = {},
): BackupManifest {
  return {
    version: RUN_BACKUP_VERSION,
    app: "spindle",
    kind: "agent-run-backup",
    createdAt: (options.now ?? new Date()).toISOString(),
    runCount: runs.length,
    runIds: runs.map((run) => run.id),
    includesSteps: true,
    includesEvents: true,
  }
}

export function buildRunBackup(
  runs: readonly AgentRunRecord[],
  options: { now?: Date } = {},
): RunBackupDocument {
  return { manifest: buildBackupManifest(runs, options), runs: [...runs] }
}

export function serializeRunBackup(doc: RunBackupDocument): string {
  return JSON.stringify(doc, null, 2)
}

export interface ParsedRunBackup {
  ok: boolean
  runs: AgentRunRecord[]
  manifest: BackupManifest | null
  error?: string
}

function looksLikeRun(value: unknown): value is AgentRunRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  // Identity fields + the two collections every consumer iterates. `metrics`
  // and `tags` are deliberately NOT required here — accepted runs are passed
  // through `normalizeAgentRunRecord`, which supplies safe defaults.
  return (
    typeof v.id === "string" &&
    typeof v.prompt === "string" &&
    typeof v.status === "string" &&
    typeof v.createdAt === "string" &&
    Array.isArray(v.steps) &&
    Array.isArray(v.events)
  )
}

/** Validate + normalize a batch of candidate runs; null on any malformed entry. */
function normalizeRunList(candidates: unknown[]): AgentRunRecord[] | null {
  if (!candidates.every(looksLikeRun)) return null
  return candidates.map((run) => normalizeAgentRunRecord(run))
}

function manifestFrom(value: unknown): BackupManifest | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (v.kind !== "agent-run-backup" || typeof v.createdAt !== "string") return null
  return {
    version: typeof v.version === "number" ? v.version : RUN_BACKUP_VERSION,
    app: "spindle",
    kind: "agent-run-backup",
    createdAt: v.createdAt,
    runCount: typeof v.runCount === "number" ? v.runCount : 0,
    runIds: Array.isArray(v.runIds)
      ? v.runIds.filter((x): x is string => typeof x === "string")
      : [],
    includesSteps: v.includesSteps !== false,
    includesEvents: v.includesEvents !== false,
  }
}

/**
 * Parse backup JSON. Accepts a full backup document, a bare run object, or
 * an array of runs (hand-edited exports). Returns `{ ok:false, error }`
 * rather than throwing on malformed input.
 */
export function parseRunBackup(text: string): ParsedRunBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, runs: [], manifest: null, error: "File is not valid JSON." }
  }

  // Full document: { manifest, runs }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const doc = data as Record<string, unknown>
    if (Array.isArray(doc.runs)) {
      const runs = normalizeRunList(doc.runs)
      if (!runs) {
        return {
          ok: false,
          runs: [],
          manifest: null,
          error: "Backup contains malformed run entries.",
        }
      }
      return { ok: true, runs, manifest: manifestFrom(doc.manifest) }
    }
    // Bare single run.
    if (looksLikeRun(doc)) {
      const run = normalizeAgentRunRecord(doc)
      return {
        ok: true,
        runs: [run],
        manifest: manifestFrom(doc.manifest) ?? buildBackupManifest([run]),
      }
    }
    return { ok: false, runs: [], manifest: null, error: "Unrecognized backup format." }
  }

  // Bare array of runs.
  if (Array.isArray(data)) {
    const runs = normalizeRunList(data)
    if (!runs) {
      return { ok: false, runs: [], manifest: null, error: "Array contains malformed run entries." }
    }
    return { ok: true, runs, manifest: buildBackupManifest(runs) }
  }

  return { ok: false, runs: [], manifest: null, error: "Unrecognized backup format." }
}

/**
 * Trigger a browser download of the backup JSON. Returns false outside the
 * browser (SSR/tests without DOM) so callers can fall back to clipboard.
 */
export function downloadRunBackup(
  runs: readonly AgentRunRecord[],
  filename = `agent-runs-backup-${new Date().toISOString().slice(0, 10)}.json`,
): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return false
  }
  try {
    const doc = buildRunBackup(runs)
    const blob = new Blob([serializeRunBackup(doc)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------------ */
/* localStorage auto-backup                                                  */
/* ------------------------------------------------------------------------ */

export function saveRunsAutoBackup(
  runs: readonly AgentRunRecord[],
  options: { now?: Date; maxRuns?: number } = {},
): boolean {
  const max = options.maxRuns ?? AUTO_BACKUP_MAX_RUNS
  const snapshot: AutoBackupSnapshot = {
    version: 1,
    savedAt: (options.now ?? new Date()).toISOString(),
    // Keep the most recent runs when over the cap.
    runs: [...runs].slice(-max),
  }
  return storageSetJson(AUTO_BACKUP_STORAGE_KEY, snapshot)
}

export function loadRunsAutoBackup(): AutoBackupSnapshot | null {
  const stored = storageGetJson<Partial<AutoBackupSnapshot>>(AUTO_BACKUP_STORAGE_KEY, {})
  if (stored.version !== 1 || !Array.isArray(stored.runs)) return null
  return {
    version: 1,
    savedAt: typeof stored.savedAt === "string" ? stored.savedAt : "",
    runs: stored.runs.filter(looksLikeRun).map((run) => normalizeAgentRunRecord(run)),
  }
}

export function clearRunsAutoBackup(): void {
  storageRemove(AUTO_BACKUP_STORAGE_KEY)
}
