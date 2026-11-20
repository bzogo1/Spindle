"use client"

/**
 * Local settings-change audit log.
 *
 * There is no settings audit API yet, so changes are recorded per scope
 * ("workspace" or `project:<id>`) in localStorage — newest first, capped —
 * and mirrored into the live activity channel via `pushActivityEvent` so a
 * settings change also surfaces on the dashboard/project activity feeds.
 * Entries survive reloads within the same browser; cross-device audit
 * history lands when the backend grows an audit endpoint.
 */

import { useEffect, useState } from "react"

import { pushActivityEvent } from "./activity/client"
import type { ActivityEvent, User } from "./api/types"

export interface SettingsAuditEntry {
  id: string
  /** Storage scope: "workspace" or `project:<projectId>`. */
  scope: string
  actorId?: string
  actorName: string
  /** Past-tense verb phrase, e.g. "updated project settings". */
  summary: string
  /** What changed — field names, an integration name, a webhook URL. */
  target?: string
  createdAt: string
}

const STORAGE_PREFIX = "spindle.settings-audit.v1."
const MAX_ENTRIES = 100
/** window CustomEvent name for same-tab live delivery. */
const AUDIT_CHANGE_EVENT = "spindle:settings-audit-change"

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`
}

function isSettingsAuditEntry(value: unknown): value is SettingsAuditEntry {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<SettingsAuditEntry>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.scope === "string" &&
    typeof candidate.actorName === "string" &&
    typeof candidate.summary === "string" &&
    typeof candidate.createdAt === "string"
  )
}

/** Newest-first audit entries for a scope. SSR- and test-safe (returns []). */
export function readSettingsAudit(scope: string): SettingsAuditEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(storageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isSettingsAuditEntry) : []
  } catch {
    return []
  }
}

/**
 * Record a settings change: persist it to localStorage, notify same-tab and
 * cross-tab subscribers, and fan it out to the live activity channel so
 * activity feeds pick it up without a refetch.
 */
export function recordSettingsAudit(
  scope: string,
  input: {
    actor?: Pick<User, "id" | "name" | "email"> | null
    summary: string
    target?: string
  },
): SettingsAuditEntry {
  const actorName = input.actor?.name ?? input.actor?.email ?? "You"
  const entry: SettingsAuditEntry = {
    id: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    scope,
    actorId: input.actor?.id,
    actorName,
    summary: input.summary,
    target: input.target,
    createdAt: new Date().toISOString(),
  }

  if (typeof window !== "undefined") {
    const next = [entry, ...readSettingsAudit(scope)].slice(0, MAX_ENTRIES)
    try {
      window.localStorage.setItem(storageKey(scope), JSON.stringify(next))
    } catch {
      // Storage full or unavailable (private mode) — the in-memory entry and
      // live delivery below still work for this session.
    }
    window.dispatchEvent(
      new CustomEvent<{ scope: string; entry: SettingsAuditEntry }>(AUDIT_CHANGE_EVENT, {
        detail: { scope, entry },
      }),
    )
  }

  pushActivityEvent(toActivityEvent(entry))
  return entry
}

/** Render an audit entry with the shared activity feed. */
export function toActivityEvent(entry: SettingsAuditEntry): ActivityEvent {
  return {
    id: entry.id,
    projectId: entry.scope.startsWith("project:")
      ? entry.scope.slice("project:".length)
      : undefined,
    kind: "system",
    actor: { id: entry.actorId ?? "system", name: entry.actorName },
    summary: entry.summary,
    // ActivityEvent targets are capped at 300 chars by isActivityEvent.
    target: entry.target?.slice(0, 300),
    createdAt: entry.createdAt,
  }
}

/**
 * Subscribe to a scope's audit log. Entries arrive newest-first and update
 * live when `recordSettingsAudit` runs in this tab, another tab
 * (BroadcastChannel is not used — `storage` events cover cross-tab writes),
 * or another device via the activity stream (those stay activity-feed-only;
 * the persisted log is per-browser).
 */
export function useSettingsAuditLog(scope: string): SettingsAuditEntry[] {
  const [entries, setEntries] = useState<SettingsAuditEntry[]>(() => readSettingsAudit(scope))

  useEffect(() => {
    setEntries(readSettingsAudit(scope))

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ scope?: string }>).detail
      if (detail?.scope === scope) setEntries(readSettingsAudit(scope))
    }

    function onStorage(event: StorageEvent) {
      if (event.key === storageKey(scope)) setEntries(readSettingsAudit(scope))
    }

    window.addEventListener(AUDIT_CHANGE_EVENT, onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(AUDIT_CHANGE_EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [scope])

  return entries
}
