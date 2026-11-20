/**
 * Ephemeral presence state (cursors, selections, user identity).
 *
 * Awareness is deliberately separate from the document op log: it is
 * high-frequency, lossy-tolerant state that must NOT be persisted or
 * causal-ordered. Merge rule: per-client last-writer-wins on `updatedAt`.
 */

export interface AwarenessUser {
  id: string
  name: string
  /** CSS colour used for this user's cursor/selection. */
  color: string
  avatarUrl?: string
}

export type PresenceStatus = "online" | "idle" | "away"

export interface AwarenessState {
  user: AwarenessUser
  /** Caret position as a visible character index (null = no cursor). */
  cursor?: number | null
  /** Selection as [anchor, head) visible character indices. */
  selection?: { anchor: number; head: number } | null
  /** Free-form document-specific payload (e.g. block id being viewed). */
  meta?: Record<string, unknown>
  /**
   * Coarse activity status. "idle"/"away" are respected as sent; "online"
   * (and an absent status) is always *derived* from `updatedAt` age so a
   * crashed peer whose last state said "online" still ages into "idle".
   */
  status?: PresenceStatus
  /** Lamport-ish timestamp; larger wins on merge. */
  updatedAt: number
}

const PALETTE = [
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#22c55e",
  "#ec4899",
  "#eab308",
  "#3b82f6",
  "#ef4444",
]

/** Deterministic colour for a user id. */
export function colorForUser(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export class Awareness {
  private readonly states = new Map<string, AwarenessState>()
  private readonly listeners = new Set<() => void>()

  /** Merge a peer's state. Returns true if anything changed. */
  apply(clientId: string, state: AwarenessState): boolean {
    const existing = this.states.get(clientId)
    if (existing) {
      // Last-writer-wins per client.
      if (existing.updatedAt > state.updatedAt) return false
      if (existing.updatedAt === state.updatedAt) {
        // Deterministic tie-break so replicas converge regardless of the
        // order updates arrive in: the lexicographically larger serialised
        // state wins. (Awareness is ephemeral/lossy-tolerant, so a rare
        // ambiguous same-ms write simply resolves consistently.)
        if (JSON.stringify(existing) >= JSON.stringify(state)) return false
      }
    }
    this.states.set(clientId, state)
    this.notify()
    return true
  }

  /** Remove a peer entirely (e.g. they left). */
  remove(clientId: string): boolean {
    const had = this.states.delete(clientId)
    if (had) this.notify()
    return had
  }

  /** All known peer states, keyed by client id. */
  getAll(): Map<string, AwarenessState> {
    return new Map(this.states)
  }

  get(clientId: string): AwarenessState | undefined {
    return this.states.get(clientId)
  }

  clear() {
    if (this.states.size) {
      this.states.clear()
      this.notify()
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const l of this.listeners) l()
  }
}

/** Serialisable wire form of an awareness update. */
export interface AwarenessMessage {
  type: "awareness"
  clientId: string
  /** null = peer left. */
  state: AwarenessState | null
}

/** Default idle threshold: no awareness update for this long → "idle". */
export const DEFAULT_IDLE_AFTER_MS = 60_000

/** One row of the online roster derived from awareness states. */
export interface PresenceEntry {
  clientId: string
  user: AwarenessUser
  status: PresenceStatus
  cursor: number | null
  selection: { anchor: number; head: number } | null
  /** Last time this peer's state was updated (ms epoch). */
  lastActiveAt: number
  /** Milliseconds since `lastActiveAt` relative to `now`. */
  idleMs: number
}

/**
 * Derive the presence roster from raw awareness states.
 *
 * Status resolution order:
 *   1. explicit "idle"/"away" is respected as sent,
 *   2. everything else (absent or explicit "online") derives from age:
 *      "idle" when `now - updatedAt > idleAfterMs`, else "online".
 * Explicit "online" is deliberately not trusted — senders omit it so a
 * dead peer can't stay "online" forever.
 */
export function derivePresence(
  all: Map<string, AwarenessState> | Iterable<[string, AwarenessState]>,
  now = Date.now(),
  idleAfterMs = DEFAULT_IDLE_AFTER_MS,
): PresenceEntry[] {
  const pairs: [string, AwarenessState][] = all instanceof Map ? [...all.entries()] : [...all]
  const out: PresenceEntry[] = []
  for (const [clientId, state] of pairs) {
    const idleMs = Math.max(0, now - state.updatedAt)
    const explicit = state.status === "idle" || state.status === "away" ? state.status : null
    const status: PresenceStatus = explicit ?? (idleMs > idleAfterMs ? "idle" : "online")
    out.push({
      clientId,
      user: state.user,
      status,
      cursor: state.cursor ?? null,
      selection: state.selection ?? null,
      lastActiveAt: state.updatedAt,
      idleMs,
    })
  }
  // Stable ordering: online first, then idle/away; alphabetical within.
  const rank = (s: PresenceStatus) => (s === "online" ? 0 : s === "idle" ? 1 : 2)
  out.sort((a, b) => rank(a.status) - rank(b.status) || a.user.name.localeCompare(b.user.name))
  return out
}
