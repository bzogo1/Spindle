"use client"

/**
 * Controller hook that wires `FileTree` to a `FileTreeSync` backend.
 *
 * State model:
 * - `serverTree` — last authoritative snapshot returned by the sync layer.
 * - `pendingOps`  — FIFO queue of `TreeMoveOp`s applied optimistically but not
 *   yet acknowledged. Ops are sent strictly one-at-a-time, in order.
 * - `tree` (returned) — `serverTree` with all pending ops replayed on top, so
 *   drags reflect instantly.
 *
 * On each response the oldest pending op is acknowledged and `reconcile`
 * merges the authoritative snapshot with the remaining queue: the server wins
 * for nodes it moved, non-conflicting local moves stay pending. Rejected ops
 * are dropped and their optimistic effect disappears on the next render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { applyMoves, move, type FileTreeNode } from "@/lib/file-tree/tree"
import { reconcile, type FileTreeSync, type TreeMoveOp } from "@/lib/file-tree/sync"

export interface UseFileTreeOptions {
  initialTree: FileTreeNode
  /** Omit for a purely local (offline) tree — moves apply without syncing. */
  sync?: FileTreeSync | null
  onSyncError?: (error: string, op: TreeMoveOp) => void
  /** Called when reconcile drops pending ops because the server won. */
  onOpsDropped?: (ops: TreeMoveOp[]) => void
}

export interface FileTreeMoveResult {
  ok: boolean
  error?: string
}

export interface UseFileTreeResult {
  /** Displayed tree: authoritative snapshot + pending optimistic moves. */
  tree: FileTreeNode
  /** Number of moves still awaiting server acknowledgement. */
  pendingCount: number
  /** True while at least one move is queued or in flight. */
  isSyncing: boolean
  /** Last sync error, cleared on the next successful response. */
  lastError: string | null
  /**
   * Validate and enqueue a move. Applies optimistically when valid; returns
   * `{ ok: false, error }` synchronously for invalid moves (missing node,
   * non-dir destination, cycle, root move).
   */
  moveNode: (nodeId: string, newParentId: string | null, index?: number) => FileTreeMoveResult
  /** Replace the whole tree (e.g. after a refetch). Drops pending ops. */
  reset: (tree: FileTreeNode) => void
}

export function useFileTree({
  initialTree,
  sync = null,
  onSyncError,
  onOpsDropped,
}: UseFileTreeOptions): UseFileTreeResult {
  const [serverTree, setServerTree] = useState(initialTree)
  const [pendingOps, setPendingOps] = useState<TreeMoveOp[]>([])
  const [lastError, setLastError] = useState<string | null>(null)

  const serverTreeRef = useRef(serverTree)
  const pendingOpsRef = useRef<TreeMoveOp[]>(pendingOps)
  const inflightRef = useRef(false)
  const mountedRef = useRef(true)
  const opSeqRef = useRef(0)

  // Callbacks may change identity every render; keep them in refs so the
  // serial pump effect doesn't re-run (and double-send) because of them.
  const syncRef = useRef(sync)
  syncRef.current = sync
  const onSyncErrorRef = useRef(onSyncError)
  onSyncErrorRef.current = onSyncError
  const onOpsDroppedRef = useRef(onOpsDropped)
  onOpsDroppedRef.current = onOpsDropped

  const tree = useMemo(() => applyMoves(serverTree, pendingOps).tree, [serverTree, pendingOps])

  const setPending = useCallback((ops: TreeMoveOp[]) => {
    pendingOpsRef.current = ops
    setPendingOps(ops)
  }, [])

  const setServer = useCallback((next: FileTreeNode) => {
    serverTreeRef.current = next
    setServerTree(next)
  }, [])

  // Serial pump: send the head of the queue, reconcile the response, repeat.
  useEffect(() => {
    const client = syncRef.current
    if (!client || inflightRef.current) return
    const op = pendingOpsRef.current[0]
    if (!op) return
    inflightRef.current = true

    client
      .applyMove(op)
      .then((response) => {
        if (!mountedRef.current) return
        inflightRef.current = false
        const rest = pendingOpsRef.current.filter((queued) => queued.opId !== op.opId)

        if (!response.ok) {
          setPending(rest)
          setLastError(response.error)
          onSyncErrorRef.current?.(response.error, op)
          return
        }

        const base = serverTreeRef.current
        const authoritative = response.tree
        const { appliedOps, droppedOps } = reconcile(authoritative, base, rest)
        setServer(authoritative)
        setPending(appliedOps)
        setLastError(null)
        if (droppedOps.length > 0) onOpsDroppedRef.current?.(droppedOps)
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) return
        inflightRef.current = false
        const rest = pendingOpsRef.current.filter((queued) => queued.opId !== op.opId)
        const message = error instanceof Error ? error.message : "Sync request failed."
        setPending(rest)
        setLastError(message)
        onSyncErrorRef.current?.(message, op)
      })
  }, [pendingOps, setPending, setServer])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Adopt a new `initialTree` (e.g. workspace refetch) when nothing is
  // pending. Consumers often rebuild the tree object every render, so compare
  // by content signature rather than identity; while ops are queued we defer
  // adoption until the queue drains (the effect re-runs on `pendingOps`).
  const lastInitialRef = useRef<string | null>(null)
  useEffect(() => {
    const signature = JSON.stringify(initialTree)
    if (signature === lastInitialRef.current) return
    if (pendingOpsRef.current.length > 0) return
    lastInitialRef.current = signature
    serverTreeRef.current = initialTree
    setServerTree(initialTree)
  }, [initialTree, pendingOps])

  const moveNode = useCallback(
    (nodeId: string, newParentId: string | null, index?: number): FileTreeMoveResult => {
      const displayed = applyMoves(serverTreeRef.current, pendingOpsRef.current).tree
      const validation = move(displayed, nodeId, newParentId, index)
      if (!validation.ok) return { ok: false, error: validation.error }
      const op: TreeMoveOp = {
        opId: `ft-op-${(opSeqRef.current += 1)}`,
        nodeId,
        newParentId,
        index,
        baseRevision: syncRef.current?.revision ?? 0,
      }
      setPending([...pendingOpsRef.current, op])
      return { ok: true }
    },
    [setPending],
  )

  const reset = useCallback(
    (next: FileTreeNode) => {
      setPending([])
      setServer(next)
      setLastError(null)
    },
    [setPending, setServer],
  )

  return {
    tree,
    pendingCount: pendingOps.length,
    isSyncing: pendingOps.length > 0,
    lastError,
    moveNode,
    reset,
  }
}
