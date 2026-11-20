"use client"

/**
 * Collaboration affordances for the automation builder.
 *
 * There is no automations API yet, so collaboration is local-only and follows
 * the same conventions as the rest of the builder:
 *
 *  - Presence: each builder instance publishes its identity and selected node
 *    over the `AUTOMATION_COLLAB_BROADCAST_CHANNEL` BroadcastChannel, so other
 *    tabs (and other builder instances in the same tab) see who is looking at
 *    which node. Peers expire quickly when heartbeats stop. A small set of
 *    simulated collaborators stands in for teammates so the affordance is
 *    visible without a second client.
 *  - Comments: per-node annotations are persisted to localStorage under the
 *    builder's history scope (same storage/event conventions as
 *    `history.ts`), so they survive reloads and sync across tabs.
 *
 * Everything is SSR- and test-safe: with no `window` the hooks no-op.
 */

import { useEffect, useRef, useState } from "react"

import { colorForUser } from "../collab/awareness"

/** BroadcastChannel name for builder presence (same origin). */
export const AUTOMATION_COLLAB_BROADCAST_CHANNEL = "spindle-automation-collab"

/** window CustomEvent name for same-tab comment-change delivery. */
const COMMENTS_CHANGE_EVENT = "spindle:automation-collab-comments-change"

const COMMENTS_STORAGE_PREFIX = "spindle.automation-graph-comments.v1."
const LOCAL_USER_STORAGE_KEY = "spindle.automation-collab-user.v1"

/** How often a client re-publishes its presence. */
const PRESENCE_HEARTBEAT_MS = 15_000
/** Peers not heard from within this window are dropped as stale. */
const PRESENCE_TTL_MS = 60_000

export interface Collaborator {
  id: string
  name: string
  /** CSS colour used for presence highlights. */
  color: string
}

/** Ephemeral presence: who is in the builder and which node they have open. */
export interface PresenceState {
  user: Collaborator
  /** Node the collaborator currently has selected, if any. */
  nodeId?: string | null
  /** Lamport-ish timestamp; larger wins on merge. */
  updatedAt: number
}

export interface NodeComment {
  id: string
  nodeId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

/**
 * Wire messages. `clientId` identifies a single hook instance (see
 * `newClientId`) — NOT the shared per-browser user id — so same-browser
 * windows/tabs still see each other as distinct peers.
 */
type CollabMessage =
  | { type: "presence"; scope: string; clientId: string; state: PresenceState }
  | { type: "presence-leave"; scope: string; clientId: string }

/* ------------------------------------------------------------------ */
/* Local identity                                                      */
/* ------------------------------------------------------------------ */

function newCollaboratorId() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Per-hook-instance client id. The collaborator identity (`local.id`) is
 * shared by every tab/instance of the same browser via localStorage, so it
 * cannot distinguish "me" from "another window of me" — the wire `clientId`
 * is what presence merge/dedupe keys on.
 */
function newClientId(userId: string) {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  return `${userId}:${rand}`
}

/**
 * Stable per-browser collaborator identity. Generated once and kept in
 * localStorage so the same person keeps the same colour/name across reloads.
 */
export function getLocalCollaborator(): Collaborator {
  if (typeof window === "undefined") {
    return { id: "local", name: "You", color: colorForUser("local") }
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_USER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Collaborator>
      if (
        typeof parsed.id === "string" &&
        typeof parsed.name === "string" &&
        typeof parsed.color === "string"
      ) {
        return { id: parsed.id, name: parsed.name, color: parsed.color }
      }
    }
    const collaborator: Collaborator = {
      id: newCollaboratorId(),
      name: "You",
      color: colorForUser(newCollaboratorId()),
    }
    window.localStorage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify(collaborator))
    return collaborator
  } catch {
    // Storage unavailable — fall back to an ephemeral identity.
    const id = newCollaboratorId()
    return { id, name: "You", color: colorForUser(id) }
  }
}

/* ------------------------------------------------------------------ */
/* Wire guards                                                         */
/* ------------------------------------------------------------------ */

function isPresenceState(value: unknown): value is PresenceState {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<PresenceState>
  const user = candidate.user as Partial<Collaborator> | undefined
  return (
    typeof user === "object" &&
    user !== null &&
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.name === "string" &&
    user.name.length > 0 &&
    typeof user.color === "string" &&
    (candidate.nodeId === undefined ||
      candidate.nodeId === null ||
      typeof candidate.nodeId === "string") &&
    typeof candidate.updatedAt === "number"
  )
}

/** Runtime guard for untrusted BroadcastChannel data. */
export function isCollabMessage(value: unknown): value is CollabMessage {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<CollabMessage>
  if (typeof candidate.scope !== "string") return false
  if (candidate.type === "presence-leave") {
    return typeof candidate.clientId === "string"
  }
  return (
    candidate.type === "presence" &&
    typeof candidate.clientId === "string" &&
    isPresenceState(candidate.state)
  )
}

/* ------------------------------------------------------------------ */
/* Simulated collaborators                                             */
/* ------------------------------------------------------------------ */

/**
 * Demo teammates so presence is visible without a second client. Each picks
 * a node deterministically from the graph so highlights stay stable across
 * renders; real peers arrive over the BroadcastChannel instead.
 */
const SIMULATED_COLLABORATORS: Collaborator[] = [
  { id: "sim_maya", name: "Maya", color: colorForUser("sim_maya") },
  { id: "sim_ihor", name: "Ihor", color: colorForUser("sim_ihor") },
  { id: "sim_sam", name: "Sam", color: colorForUser("sim_sam") },
]

function hashString(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return h
}

export function simulatedPresence(nodeIds: readonly string[]): PresenceState[] {
  if (nodeIds.length === 0) return []
  const now = Date.now()
  return SIMULATED_COLLABORATORS.map((user, index) => ({
    user,
    nodeId: nodeIds[(hashString(user.id) + index * 5) % nodeIds.length],
    updatedAt: now,
  }))
}

/* ------------------------------------------------------------------ */
/* Presence hook                                                       */
/* ------------------------------------------------------------------ */

export interface AutomationPresence {
  /** The local user's collaborator identity. */
  local: Collaborator
  /** Remote (BroadcastChannel) + simulated peers, local user excluded. */
  peers: PresenceState[]
}

/**
 * Publish local presence (identity + selected node) over the
 * `AUTOMATION_COLLAB_BROADCAST_CHANNEL` BroadcastChannel and merge in remote
 * peers. Peers heartbeat every {@link PRESENCE_HEARTBEAT_MS}; states older
 * than {@link PRESENCE_TTL_MS} are pruned on each heartbeat tick. Simulated
 * collaborators are appended deterministically from `nodeIds`.
 */
export function useAutomationPresence(
  scope: string,
  selection: { nodeId: string | null },
  nodeIds: readonly string[],
): AutomationPresence {
  const [local] = useState<Collaborator>(getLocalCollaborator)
  // Unique per hook instance — two builders in the same browser share
  // `local.id` but must still see each other as distinct peers.
  const [clientId] = useState(() => newClientId(local.id))
  const [remotePeers, setRemotePeers] = useState<ReadonlyMap<string, PresenceState>>(
    () => new Map(),
  )
  // Selection lives in a ref so the heartbeat always publishes the latest
  // value without re-subscribing the channel on every click.
  const selectionRef = useRef(selection.nodeId)
  selectionRef.current = selection.nodeId

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      return
    }
    const channel = new BroadcastChannel(AUTOMATION_COLLAB_BROADCAST_CHANNEL)
    const receivedAt = new Map<string, number>()
    // A scope change means a different automation — drop the previous
    // scope's peers so stale selections don't bleed across graphs.
    setRemotePeers(new Map())
    receivedAt.clear()

    function publish() {
      const state: PresenceState = {
        user: local,
        nodeId: selectionRef.current,
        updatedAt: Date.now(),
      }
      const message: CollabMessage = {
        type: "presence",
        scope,
        clientId,
        state,
      }
      try {
        channel.postMessage(message)
      } catch {
        // Channel closed mid-flight — presence is best-effort.
      }
    }

    function pruneStale() {
      const cutoff = Date.now() - PRESENCE_TTL_MS
      setRemotePeers((current) => {
        let changed = false
        const next = new Map(current)
        for (const peerId of next.keys()) {
          const seen = receivedAt.get(peerId) ?? 0
          if (seen < cutoff) {
            next.delete(peerId)
            receivedAt.delete(peerId)
            changed = true
          }
        }
        return changed ? next : current
      })
    }

    function onMessage(event: MessageEvent) {
      const data: unknown = event.data
      if (!isCollabMessage(data) || data.scope !== scope) return
      if (data.type === "presence-leave") {
        receivedAt.delete(data.clientId)
        setRemotePeers((current) => {
          if (!current.has(data.clientId)) return current
          const next = new Map(current)
          next.delete(data.clientId)
          return next
        })
        return
      }
      // Self-filter by per-instance clientId, NOT user.id — other windows of
      // the same browser share the user identity but are legitimate peers.
      if (data.clientId === clientId) return
      receivedAt.set(data.clientId, Date.now())
      setRemotePeers((current) => {
        const existing = current.get(data.clientId)
        // Last-writer-wins per client, matching Awareness merge rules.
        if (existing && existing.updatedAt > data.state.updatedAt) return current
        const next = new Map(current)
        next.set(data.clientId, data.state)
        return next
      })
    }

    channel.addEventListener("message", onMessage)
    publish()
    const heartbeat = window.setInterval(() => {
      publish()
      pruneStale()
    }, PRESENCE_HEARTBEAT_MS)

    return () => {
      window.clearInterval(heartbeat)
      channel.removeEventListener("message", onMessage)
      try {
        channel.postMessage({
          type: "presence-leave",
          scope,
          clientId,
        } satisfies CollabMessage)
        channel.close()
      } catch {
        // Ignore — the tab is going away anyway.
      }
    }
    // `local`/`clientId` are stable for the component's lifetime; `scope`
    // re-subscribes when the automation changes. The latest selection is
    // read through a ref so it never needs to be an effect dependency.
  }, [scope, local, clientId])

  // Publish immediately when the selection changes (in addition to the
  // heartbeat) so peers see focus moves without delay.
  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return
    const state: PresenceState = {
      user: local,
      nodeId: selection.nodeId,
      updatedAt: Date.now(),
    }
    try {
      const channel = new BroadcastChannel(AUTOMATION_COLLAB_BROADCAST_CHANNEL)
      channel.postMessage({
        type: "presence",
        scope,
        clientId,
        state,
      } satisfies CollabMessage)
      channel.close()
    } catch {
      // BroadcastChannel unavailable — heartbeat path may still deliver.
    }
  }, [scope, local, clientId, selection.nodeId])

  const peers = [...remotePeers.values(), ...simulatedPresence(nodeIds)]
  return { local, peers }
}

/* ------------------------------------------------------------------ */
/* Node comments                                                       */
/* ------------------------------------------------------------------ */

export function nodeCommentsStorageKey(scope: string) {
  return `${COMMENTS_STORAGE_PREFIX}${scope}`
}

function isNodeComment(value: unknown): value is NodeComment {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<NodeComment>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.nodeId === "string" &&
    typeof candidate.authorId === "string" &&
    typeof candidate.authorName === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.createdAt === "string"
  )
}

/** All comments for a scope, oldest first (thread order). SSR-safe. */
export function readNodeComments(scope: string): NodeComment[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(nodeCommentsStorageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isNodeComment) : []
  } catch {
    return []
  }
}

function writeNodeComments(scope: string, comments: NodeComment[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(nodeCommentsStorageKey(scope), JSON.stringify(comments))
  } catch {
    // Storage full or unavailable — comments just won't persist.
  }
}

function notifyCommentsChange(scope: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<{ scope: string }>(COMMENTS_CHANGE_EVENT, { detail: { scope } }),
  )
}

/**
 * Add a comment to a node. Returns the stored comment, or `null` when the
 * body is blank. The author defaults to the local collaborator identity.
 */
export function addNodeComment(
  scope: string,
  input: { nodeId: string; body: string; author?: Collaborator },
): NodeComment | null {
  const body = input.body.trim()
  if (!body) return null
  const author = input.author ?? getLocalCollaborator()
  const comment: NodeComment = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    nodeId: input.nodeId,
    authorId: author.id,
    authorName: author.name,
    body,
    createdAt: new Date().toISOString(),
  }
  writeNodeComments(scope, [...readNodeComments(scope), comment])
  notifyCommentsChange(scope)
  return comment
}

/** Remove a single comment. No-op when the id is not stored for the scope. */
export function deleteNodeComment(scope: string, commentId: string): void {
  const comments = readNodeComments(scope)
  const next = comments.filter((comment) => comment.id !== commentId)
  if (next.length === comments.length) return
  writeNodeComments(scope, next)
  notifyCommentsChange(scope)
}

/**
 * Subscribe to a scope's comments. Updates live when `addNodeComment`/
 * `deleteNodeComment` run in this tab or another tab (`storage` events
 * cover cross-tab writes), matching `useGraphVersions`.
 */
export function useNodeComments(scope: string): NodeComment[] {
  const [comments, setComments] = useState<NodeComment[]>(() => readNodeComments(scope))

  useEffect(() => {
    setComments(readNodeComments(scope))

    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ scope?: string }>).detail
      if (detail?.scope === scope) setComments(readNodeComments(scope))
    }

    function onStorage(event: StorageEvent) {
      if (event.key === nodeCommentsStorageKey(scope)) setComments(readNodeComments(scope))
    }

    window.addEventListener(COMMENTS_CHANGE_EVENT, onChange)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(COMMENTS_CHANGE_EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [scope])

  return comments
}
