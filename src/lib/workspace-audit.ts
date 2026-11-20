/**
 * Workspace audit log — DEVELOPMENT seam.
 *
 * In-memory, per-process store of workspace-scoped events (member role
 * changes, workspace rename, settings updates, deletion requests, SSO
 * config changes, ...). Like {@link MemoryAuthBackend} this loses state on
 * restart and does not scale past one process; production MUST persist
 * these rows. The shape is deliberately generic (`type` + `details`) so any
 * workspace feature can emit events without schema migrations.
 *
 * Emitters call {@link recordWorkspaceEvent} AFTER the mutation succeeds.
 * Reads go through {@link listWorkspaceEvents}, normally behind
 * `/api/workspaces/[id]/audit` which enforces membership server-side.
 */

export type WorkspaceAuditEvent = {
  id: string
  workspaceId: string
  /** Dotted event type, e.g. "member.role_changed", "workspace.renamed". */
  type: string
  /** User id of the actor, when known. */
  actorId: string | null
  /** Free-form context (old/new values, target ids). Never secrets. */
  details: Record<string, unknown>
  createdAt: string
}

const MAX_EVENTS_PER_WORKSPACE = 500
const events: WorkspaceAuditEvent[] = []
let counter = 0

export function recordWorkspaceEvent(input: {
  workspaceId: string
  type: string
  actorId?: string | null
  details?: Record<string, unknown>
  now?: number
}): WorkspaceAuditEvent {
  counter += 1
  const event: WorkspaceAuditEvent = {
    id: `wae_${counter.toString(36)}_${Date.now().toString(36)}`,
    workspaceId: input.workspaceId,
    type: input.type,
    actorId: input.actorId ?? null,
    details: input.details ?? {},
    createdAt: new Date(input.now ?? Date.now()).toISOString(),
  }
  events.push(event)

  // Bound memory: drop the oldest events for this workspace beyond the cap.
  let count = 0
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].workspaceId === input.workspaceId) {
      count += 1
      if (count > MAX_EVENTS_PER_WORKSPACE) events.splice(i, 1)
    }
  }
  return event
}

export type WorkspaceAuditFilter = {
  /** Substring match on event type (e.g. "member."). */
  type?: string
  /** Only events at or after this ISO timestamp. */
  since?: string
  /** Only events at or before this ISO timestamp. */
  until?: string
  limit?: number
  offset?: number
}

/** Newest-first page of events for one workspace. */
export function listWorkspaceEvents(
  workspaceId: string,
  filter: WorkspaceAuditFilter = {},
): { events: WorkspaceAuditEvent[]; total: number } {
  const typeNeedle = filter.type?.toLowerCase()
  const sinceMs = filter.since ? Date.parse(filter.since) : NaN
  const untilMs = filter.until ? Date.parse(filter.until) : NaN

  const matched = events.filter((event) => {
    if (event.workspaceId !== workspaceId) return false
    if (typeNeedle && !event.type.toLowerCase().includes(typeNeedle)) return false
    const at = Date.parse(event.createdAt)
    if (!Number.isNaN(sinceMs) && at < sinceMs) return false
    if (!Number.isNaN(untilMs) && at > untilMs) return false
    return true
  })

  // events are appended chronologically; reverse for newest-first.
  matched.reverse()
  const offset = Math.max(0, filter.offset ?? 0)
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50))
  return { events: matched.slice(offset, offset + limit), total: matched.length }
}

/** TEST-ONLY: clears all recorded events. */
export function resetWorkspaceAuditForTests(): void {
  events.length = 0
  counter = 0
}
