"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { CollaborativeDocument } from "@/lib/collab/document"
import type { CollabClient } from "@/lib/collab/sync"
import type { OfflineOpQueue } from "@/lib/collab/offline"
import {
  Awareness,
  DEFAULT_IDLE_AFTER_MS,
  colorForUser,
  type AwarenessState,
  type AwarenessUser,
  type PresenceStatus,
} from "@/lib/collab/awareness"
import { ConflictDetector } from "@/lib/collab/conflict"
import { CollaborativeEditor } from "./CollaborativeEditor"
import { PresenceCursors, type CursorPoint } from "./PresenceCursors"
import { PresenceBar } from "./PresenceBar"
import { ConflictBanner } from "./ConflictBanner"

export interface CollaborativeDocProps {
  document: CollaborativeDocument
  clientId: string
  /** Live sync client; may be null while offline. */
  client?: CollabClient | null
  /** Offline op queue; flushed automatically when the client connects. */
  offlineQueue?: OfflineOpQueue | null
  /** Shared awareness instance; one is created internally if omitted. */
  awareness?: Awareness
  /** Local user identity shown to peers. */
  user?: AwarenessUser
  className?: string
  editorClassName?: string
  placeholder?: string
  disabled?: boolean
  /** Pixel offset of the text origin inside the editor (border+padding). */
  textOffset?: { x: number; y: number }
  /** Line height in px used for caret/selection overlay geometry. */
  lineHeight?: number
  /** Show the collaborator roster bar (join/leave + status). Default true. */
  showPresenceBar?: boolean
  /** Show conflict-resolution banners for concurrent same-range edits. Default true. */
  showConflictBanner?: boolean
  /** Idle threshold for presence status derivation. Default 60s. */
  idleAfterMs?: number
}

const currentStatus = (lastActivity: number, idleAfterMs: number): PresenceStatus =>
  Date.now() - lastActivity > idleAfterMs ? "idle" : "online"

/**
 * Composes CollaborativeEditor + PresenceCursors and wires up sync,
 * offline queueing, presence roster and conflict resolution for a shared
 * document.
 *
 * All collaborators must construct this with the same `document` id on the
 * server side; client-side this component is a view over the CRDT.
 */
export function CollaborativeDoc({
  document,
  clientId,
  client = null,
  offlineQueue = null,
  awareness: externalAwareness,
  user,
  className,
  editorClassName,
  placeholder,
  disabled,
  textOffset = { x: 13, y: 13 },
  lineHeight = 20,
  showPresenceBar = true,
  showConflictBanner = true,
  idleAfterMs = DEFAULT_IDLE_AFTER_MS,
}: CollaborativeDocProps) {
  const internalAwareness = React.useRef<Awareness | null>(null)
  if (!internalAwareness.current) internalAwareness.current = new Awareness()
  const awareness = externalAwareness ?? internalAwareness.current

  const resolvedUser: AwarenessUser = React.useMemo(
    () => user ?? { id: clientId, name: clientId, color: colorForUser(clientId) },
    [user, clientId],
  )

  const [selection, setSelectionState] = React.useState<{ start: number; end: number } | null>(null)
  const selectionRef = React.useRef(selection)
  const lastActivityRef = React.useRef(Date.now())
  const lastStatusRef = React.useRef<PresenceStatus>("online")
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0)
  const measureRef = React.useRef<CanvasRenderingContext2D | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)

  // Conflict detector: watches local edits vs remote ops, surfaces UI.
  // Recreated if the document instance changes; disposed on unmount.
  const detectorRef = React.useRef<{
    doc: CollaborativeDocument
    detector: ConflictDetector
  } | null>(null)
  if (!detectorRef.current || detectorRef.current.doc !== document) {
    detectorRef.current?.detector.dispose()
    detectorRef.current = { doc: document, detector: new ConflictDetector(document) }
  }
  const detector = detectorRef.current.detector
  React.useEffect(() => detector.onChange(forceRender), [detector])
  React.useEffect(() => () => detectorRef.current?.detector.dispose(), [])

  // Subscribe to awareness changes BEFORE the presence-broadcast effect
  // below, so the local user's own state triggers a roster re-render.
  React.useEffect(() => {
    return awareness.onChange(forceRender)
  }, [awareness])

  const setSelection = React.useCallback((sel: { start: number; end: number } | null) => {
    selectionRef.current = sel
    setSelectionState(sel)
    lastActivityRef.current = Date.now()
  }, [])

  const handleActivity = React.useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  // Broadcast local presence (with derived idle/online status).
  const pushPresence = React.useCallback(
    (status: PresenceStatus) => {
      lastStatusRef.current = status
      const sel = selectionRef.current
      const state: AwarenessState = {
        user: resolvedUser,
        cursor: sel ? sel.end : null,
        selection: sel && sel.start !== sel.end ? { anchor: sel.start, head: sel.end } : null,
        // Only explicit non-online statuses are sent; "online" is derived
        // by receivers from updatedAt so a crashed peer can't stay online.
        ...(status === "online" ? {} : { status }),
        updatedAt: Date.now(),
      }
      awareness.apply(clientId, state)
      client?.sendAwareness(state)
    },
    [awareness, client, clientId, resolvedUser],
  )

  // Route remote ops + awareness into the models.
  React.useEffect(() => {
    if (!client) return
    client.setHandlers({
      onOps: (ops) => {
        document.applyRemoteOps(ops)
      },
      onAwareness: (cid, state) => {
        if (state) awareness.apply(cid, state)
        else awareness.remove(cid)
      },
      onOpen: () => {
        // Flush offline queue now that we're connected.
        if (offlineQueue) {
          void offlineQueue.flush(async (op) => {
            if (!client.connected) return false
            client.sendOps([op])
            return true
          })
        }
      },
    })
    return () => {
      client.setHandlers({})
    }
  }, [client, document, offlineQueue, awareness])

  // Broadcast presence whenever selection/status inputs change.
  React.useEffect(() => {
    pushPresence(currentStatus(lastActivityRef.current, idleAfterMs))
  }, [pushPresence, selection, idleAfterMs])

  // Heartbeat: flip local status to "idle" after inactivity and broadcast.
  React.useEffect(() => {
    const t = setInterval(() => {
      const status = currentStatus(lastActivityRef.current, idleAfterMs)
      if (status !== lastStatusRef.current) pushPresence(status)
    }, 10_000)
    return () => clearInterval(t)
  }, [pushPresence, idleAfterMs])

  React.useEffect(() => {
    return () => {
      client?.sendAwareness(null)
      awareness.remove(clientId)
    }
  }, [client, awareness, clientId])

  // Flush persisted ops on mount even before connect (they'll send onOpen).
  React.useEffect(() => {
    void offlineQueue?.load()
  }, [offlineQueue])

  const toPosition = React.useCallback(
    (index: number): CursorPoint => {
      const text = document.text
      const clamped = Math.max(0, Math.min(index, text.length))
      const before = text.slice(0, clamped)
      const line = (before.match(/\n/g) ?? []).length
      const lineStart = before.lastIndexOf("\n") + 1
      const colText = before.slice(lineStart)

      if (typeof window === "undefined") {
        return { x: textOffset.x + clamped * 8, y: textOffset.y + line * lineHeight }
      }
      if (!measureRef.current) {
        const canvas = window.document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        if (ctx) {
          // Probe THIS editor's textarea (scoped to our subtree — a page may
          // host several collaborative editors).
          const probe = rootRef.current?.querySelector("textarea") ?? null
          const style = probe ? window.getComputedStyle(probe) : null
          ctx.font = style
            ? `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            : "14px monospace"
          measureRef.current = ctx
        }
      }
      const width = measureRef.current
        ? measureRef.current.measureText(colText).width
        : colText.length * 8
      return {
        x: textOffset.x + width,
        y: textOffset.y + line * lineHeight,
      }
    },
    [document, textOffset.x, textOffset.y, lineHeight],
  )

  // Computed each render: `forceRender` (driven by awareness.onChange and
  // detector.onChange) guarantees freshness without memo staleness.
  const remoteEntries: { clientId: string; state: AwarenessState }[] = []
  const presenceEntries: { clientId: string; state: AwarenessState }[] = []
  for (const [cid, state] of awareness.getAll()) {
    presenceEntries.push({ clientId: cid, state })
    if (cid !== clientId) remoteEntries.push({ clientId: cid, state })
  }

  return (
    <div ref={rootRef} className={cn("w-full", className)}>
      {showPresenceBar && (
        <PresenceBar
          entries={presenceEntries}
          selfId={clientId}
          idleAfterMs={idleAfterMs}
          className="mb-2"
        />
      )}
      {showConflictBanner && (
        <ConflictBanner
          conflicts={detector.getConflicts()}
          onResolve={(id, resolution) => detector.resolve(id, resolution)}
          className="mb-2"
        />
      )}
      <div className="relative w-full">
        <CollaborativeEditor
          document={document}
          client={client}
          offlineQueue={offlineQueue}
          onSelectionChange={setSelection}
          onActivity={handleActivity}
          placeholder={placeholder}
          disabled={disabled}
          className={editorClassName}
        />
        <PresenceCursors entries={remoteEntries} toPosition={toPosition} lineHeight={lineHeight} />
      </div>
    </div>
  )
}
