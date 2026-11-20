/**
 * Pluggable server-sync layer for file-tree mutations.
 *
 * Contract (for backend wiring):
 *
 * - The client sends one `TreeMoveOp` at a time, strictly in enqueue order.
 *   Each op carries `baseRevision` — the server revision the client based the
 *   move on — so the backend can detect stale writes.
 * - `applyMove` MUST resolve with `{ ok: true, tree, revision }` where `tree`
 *   is the *authoritative* post-op snapshot. The snapshot may include other
 *   clients' concurrent changes; the client reconciles locally-held pending
 *   ops on top of it (see `reconcile`). Returning the bare applied tree is
 *   fine when no other client wrote in between.
 * - `{ ok: false, error }` rejects the op; the client drops it and reverts the
 *   optimistic effect (other queued ops are still sent).
 * - `revision` is an opaque monotonic token (etag/version/seq). The client
 *   stores it on each op as `baseRevision` for the next round-trip.
 *
 * Merge strategy (documented + implemented in `reconcile`):
 *   "Server wins for conflicting nodes; replay non-conflicting pending ops."
 *   A pending op conflicts — and is dropped — when, relative to the client's
 *   last-known base tree, the server changed the moved node's parent (or
 *   deleted the node / destination / made the move invalid). Ordering-only
 *   changes by other clients do NOT conflict: the pending op's explicit
 *   parent+index wins for that node (last-applied-writer-wins per node).
 */

import {
  applyMoves,
  cloneTree,
  findNode,
  findParent,
  move,
  type FileTreeNode,
  type MoveNodeInput,
} from "./tree"

/** A queued move mutation awaiting (or in) a server round-trip. */
export interface TreeMoveOp extends MoveNodeInput {
  /** Client-generated idempotency key — safe for the backend to dedupe on. */
  opId: string
  /** Server revision the client based this op on. */
  baseRevision: number
}

export type TreeSyncResponse =
  { ok: true; tree: FileTreeNode; revision: number } | { ok: false; error: string }

/**
 * Backend-facing sync contract. Implementations must apply ops in order and
 * return the authoritative tree snapshot on success.
 */
export interface FileTreeSync {
  /** Latest known server revision (0 before the first response). */
  readonly revision: number
  applyMove(op: TreeMoveOp): Promise<TreeSyncResponse>
}

export interface MockFileTreeSyncOptions {
  tree: FileTreeNode
  /** Simulated network latency in ms (default 0). */
  latencyMs?: number
  /**
   * Test/dev hook invoked after the latency wait but before the op is
   * applied — use it to simulate another client's writes landing first.
   */
  beforeApply?: (tree: FileTreeNode, op: TreeMoveOp) => FileTreeNode
  /** Return an error message to force this op to fail. */
  failWith?: (op: TreeMoveOp) => string | null
}

/**
 * In-memory `FileTreeSync` for development and tests. Applies ops to a local
 * snapshot with an optional artificial latency.
 */
export class MockFileTreeSync implements FileTreeSync {
  private tree: FileTreeNode
  private rev: number
  private readonly latencyMs: number
  private readonly beforeApply?: MockFileTreeSyncOptions["beforeApply"]
  private readonly failWith?: MockFileTreeSyncOptions["failWith"]

  constructor(options: MockFileTreeSyncOptions) {
    this.tree = cloneTree(options.tree)
    this.rev = 0
    this.latencyMs = options.latencyMs ?? 0
    this.beforeApply = options.beforeApply
    this.failWith = options.failWith
  }

  get revision() {
    return this.rev
  }

  /** Current authoritative snapshot (for tests/dev tooling). */
  getTree() {
    return cloneTree(this.tree)
  }

  async applyMove(op: TreeMoveOp): Promise<TreeSyncResponse> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
    }
    const failure = this.failWith?.(op)
    if (failure) return { ok: false, error: failure }

    let candidate = this.beforeApply ? this.beforeApply(cloneTree(this.tree), op) : this.tree
    const result = applyMoves(candidate, [
      { nodeId: op.nodeId, newParentId: op.newParentId, index: op.index },
    ])
    if (result.skipped.length > 0) {
      const reason = move(candidate, op.nodeId, op.newParentId, op.index)
      return {
        ok: false,
        error: reason.ok ? "Move rejected." : reason.error,
      }
    }
    this.tree = result.tree
    this.rev += 1
    return { ok: true, tree: cloneTree(this.tree), revision: this.rev }
  }
}

/** Canonical parent id used for conflict comparison: `null` = top level (root's children). */
function canonicalParentId(tree: FileTreeNode, parent: FileTreeNode | null): string | null {
  if (!parent || parent.id === tree.id) return null
  return parent.id
}

function parentMap(tree: FileTreeNode): Map<string, string | null> {
  const map = new Map<string, string | null>()
  const walk = (node: FileTreeNode, parent: FileTreeNode | null) => {
    map.set(node.id, canonicalParentId(tree, parent))
    node.children.forEach((child) => walk(child, node))
  }
  walk(tree, null)
  return map
}

export interface ReconcileResult {
  /** Authoritative server tree with surviving pending ops applied on top. */
  tree: FileTreeNode
  /** Pending ops that were replayed successfully (still awaiting their own ack). */
  appliedOps: TreeMoveOp[]
  /** Pending ops dropped because the server state conflicted or invalidated them. */
  droppedOps: TreeMoveOp[]
}

/**
 * Merge an authoritative `serverTree` with the client's still-pending ops.
 *
 * `baseTree` is the client's previous authoritative snapshot — the state every
 * pending op was originally validated against. `pendingOps` must be in
 * enqueue order.
 *
 * For each pending op, in order:
 *  1. If the node is gone on the server → drop (server wins).
 *  2. Compute the node's expected parent: the parent implied by `baseTree`,
 *     overridden by any earlier op *applied during this pass*. If the actual
 *     parent on the merged tree differs → another client moved the node →
 *     drop (server wins for that node).
 *  3. Try `move()`; validation failures (bad destination, cycle) → drop.
 *  4. Otherwise apply and continue.
 */
export function reconcile(
  serverTree: FileTreeNode,
  baseTree: FileTreeNode,
  pendingOps: TreeMoveOp[],
): ReconcileResult {
  let work = cloneTree(serverTree)
  const baseParents = parentMap(baseTree)
  const appliedOps: TreeMoveOp[] = []
  const droppedOps: TreeMoveOp[] = []

  /** Latest parent this client expects `nodeId` to have, or undefined if unknown. */
  const expectedParent = (nodeId: string): string | null | undefined => {
    for (let i = appliedOps.length - 1; i >= 0; i -= 1) {
      const op = appliedOps[i]
      if (op.nodeId === nodeId) {
        return op.newParentId === null || op.newParentId === work.id ? null : op.newParentId
      }
    }
    return baseParents.get(nodeId)
  }

  const actualParent = (nodeId: string): string | null | undefined => {
    const node = findNode(work, nodeId)
    if (!node) return undefined
    return canonicalParentId(work, findParent(work, nodeId))
  }

  for (const op of pendingOps) {
    const node = findNode(work, op.nodeId)
    if (!node) {
      droppedOps.push(op)
      continue
    }
    const expected = expectedParent(op.nodeId)
    const actual = actualParent(op.nodeId)
    if (expected !== undefined && actual !== undefined && expected !== actual) {
      // The server (or a prior reconcile) placed this node somewhere else.
      droppedOps.push(op)
      continue
    }
    const result = move(work, op.nodeId, op.newParentId, op.index)
    if (!result.ok) {
      droppedOps.push(op)
      continue
    }
    // `move` returns a fresh tree; adopt it as the new working tree.
    work = result.value
    appliedOps.push(op)
  }

  return { tree: work, appliedOps, droppedOps }
}
