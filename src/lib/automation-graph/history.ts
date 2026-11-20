"use client"

/**
 * Local version history for automation graphs.
 *
 * There is no automations API yet, so graph snapshots are recorded per scope
 * in localStorage — newest first, capped — following the same conventions as
 * `src/lib/settings-audit.ts`. The builder debounces edits into snapshots;
 * callers can also record explicit named snapshots. Entries survive reloads
 * within the same browser.
 */

import { useEffect, useState } from "react"

import { serializeGraph } from "./graph"
import type { AutomationGraph } from "./types"

export interface GraphVersion {
  id: string
  /** Optional user-supplied label; the UI falls back to the graph name. */
  label?: string
  /** Optional free-form comment describing what changed in this version. */
  comment?: string
  graph: AutomationGraph
  createdAt: string
}

const STORAGE_PREFIX = "spindle.automation-graph-history.v1."
export const GRAPH_HISTORY_MAX_VERSIONS = 30
/** window CustomEvent name for same-tab live delivery. */
const HISTORY_CHANGE_EVENT = "spindle:automation-graph-history-change"

export function graphHistoryStorageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`
}

function isAutomationGraph(value: unknown): value is AutomationGraph {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<AutomationGraph>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges)
  )
}

function isGraphVersion(value: unknown): value is GraphVersion {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<GraphVersion>
  return (
    typeof candidate.id === "string" &&
    (candidate.label === undefined || typeof candidate.label === "string") &&
    (candidate.comment === undefined || typeof candidate.comment === "string") &&
    isAutomationGraph(candidate.graph) &&
    typeof candidate.createdAt === "string"
  )
}

/** Newest-first versions for a scope. SSR- and test-safe (returns []). */
export function readGraphVersions(scope: string): GraphVersion[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(graphHistoryStorageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isGraphVersion) : []
  } catch {
    return []
  }
}

function writeGraphVersions(scope: string, versions: GraphVersion[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(graphHistoryStorageKey(scope), JSON.stringify(versions))
  } catch {
    // Storage full or unavailable (private mode) — history just won't persist.
  }
}

function notifyHistoryChange(scope: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<{ scope: string }>(HISTORY_CHANGE_EVENT, { detail: { scope } }),
  )
}

/**
 * Serialize for dedupe comparison. `graph.id` is excluded because restoring a
 * version keeps the *current* graph id, so a restored graph would otherwise
 * serialize differently from the stored snapshot and get recorded as a
 * near-duplicate.
 */
function canonicalSerialize(graph: AutomationGraph): string {
  return serializeGraph({ ...graph, id: "" })
}

/**
 * Record a snapshot of `graph` for `scope`. Returns `null` when the graph is
 * identical (by serialized DSL, ignoring `graph.id`) to the newest stored
 * version, so callers can fire on every edit without flooding the history.
 */
export function recordGraphVersion(
  scope: string,
  graph: AutomationGraph,
  label?: string,
): GraphVersion | null {
  const versions = readGraphVersions(scope)
  const serialized = canonicalSerialize(graph)
  const head = versions[0]
  if (head && canonicalSerialize(head.graph) === serialized) {
    // Same graph as the newest snapshot: only relabel the head when the
    // caller supplied a label; otherwise there's nothing new to record.
    const nextLabel = label?.trim()
    if (!nextLabel || head.label === nextLabel) return null
    const next = [{ ...head, label: nextLabel }, ...versions.slice(1)]
    writeGraphVersions(scope, next)
    notifyHistoryChange(scope)
    return next[0]
  }

  const version: GraphVersion = {
    id: `gv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    label: label?.trim() || undefined,
    graph,
    createdAt: new Date().toISOString(),
  }
  const next = [version, ...versions].slice(0, GRAPH_HISTORY_MAX_VERSIONS)
  writeGraphVersions(scope, next)
  notifyHistoryChange(scope)
  return version
}

/**
 * Set or clear the comment on a stored version. Empty/whitespace comments
 * remove the field. No-op when the version id is unknown.
 */
export function updateGraphVersionComment(scope: string, versionId: string, comment: string): void {
  const versions = readGraphVersions(scope)
  const trimmed = comment.trim()
  let changed = false
  const next = versions.map((version) => {
    if (version.id !== versionId) return version
    changed = true
    const { comment: _previous, ...rest } = version
    return trimmed ? { ...rest, comment: trimmed } : rest
  })
  if (!changed) return
  writeGraphVersions(scope, next)
  notifyHistoryChange(scope)
}

/** Remove a single version. No-op when the id is not stored for the scope. */
export function deleteGraphVersion(scope: string, versionId: string): void {
  const versions = readGraphVersions(scope)
  const next = versions.filter((version) => version.id !== versionId)
  if (next.length === versions.length) return
  writeGraphVersions(scope, next)
  notifyHistoryChange(scope)
}

/**
 * Subscribe to a scope's version history. Versions arrive newest-first and
 * update live when `recordGraphVersion`/`deleteGraphVersion` run in this tab
 * or another tab (`storage` events cover cross-tab writes).
 */
export function useGraphVersions(scope: string): GraphVersion[] {
  const [versions, setVersions] = useState<GraphVersion[]>(() => readGraphVersions(scope))

  useEffect(() => {
    setVersions(readGraphVersions(scope))

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ scope?: string }>).detail
      if (detail?.scope === scope) setVersions(readGraphVersions(scope))
    }

    function onStorage(event: StorageEvent) {
      if (event.key === graphHistoryStorageKey(scope)) setVersions(readGraphVersions(scope))
    }

    window.addEventListener(HISTORY_CHANGE_EVENT, onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(HISTORY_CHANGE_EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [scope])

  return versions
}
