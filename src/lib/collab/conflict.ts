import type { CollaborativeDocument } from "./document"
import { SequenceCRDT, type CrdtId, type CrdtOp } from "./crdt"

/**
 * Conflict detection + resolution for concurrent same-range edits.
 *
 * The CRDT itself always merges concurrent edits deterministically, but
 * sometimes two users typing in the same spot want an explicit choice.
 * This detector watches local edits (via `onLocalOps`) and remote op
 * batches (via `onRemoteOps`); when a remote op lands inside a recently
 * edited local region it records a `TextConflict` describing both sides.
 *
 * Resolution is applied *through the CRDT* (`deleteByIds` / `insertText`),
 * so the outcome propagates to peers like any other edit:
 *   - "local"  → remove the remote contribution (keep the local version)
 *   - "remote" → remove the local contribution (keep the remote version)
 *   - "merge"  → keep both as the CRDT already interleaved them
 */

export type ConflictKind =
  /** Remote insert landed in a span the local user recently edited. */
  | "concurrent-insert"
  /** Remote delete removed characters the local user recently inserted. */
  | "overlapping-delete"

export type ConflictResolution = "local" | "remote" | "merge"

export interface TextConflict {
  id: string
  kind: ConflictKind
  /** Approximate visible range [start, end) the conflict spans. */
  start: number
  end: number
  /** What the local user typed / deleted for this span. */
  localText: string
  /** What the remote peer contributed ("" for pure deletions). */
  remoteText: string
  createdAt: number
  /** Remote-inserted item ids — deleted when resolving "local". */
  remoteIds: CrdtId[]
  /** Local-inserted item ids — deleted when resolving "remote". */
  localIds: CrdtId[]
  /** Local text deleted by this edit (restore candidate for "local"). */
  localDeletedText: string
}

interface LocalEdit {
  /** Visible range the edit touched (post-edit coordinates for inserts). */
  start: number
  end: number
  insertedIds: CrdtId[]
  insertedText: string
  /** Text this edit removed ("" for pure inserts). */
  deletedText: string
  ts: number
}

export interface ConflictDetectorOptions {
  /** Local edits older than this (ms) no longer conflict. Default 30s. */
  windowMs?: number
  /** Max pending local edits retained. Default 50. */
  maxPending?: number
  /** Max unresolved conflicts retained. Default 20. */
  maxConflicts?: number
  /** Injectable clock for tests. */
  now?: () => number
}

const idKey = (id: CrdtId) => `${id.client}:${id.clock}`

export class ConflictDetector {
  private readonly doc: CollaborativeDocument
  private readonly opts: Required<Omit<ConflictDetectorOptions, "now">> & {
    now: () => number
  }
  private pending: LocalEdit[] = []
  private conflicts: TextConflict[] = []
  private readonly sigToId = new Map<string, string>()
  private readonly idToSig = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private seq = 0
  private lastText: string
  private readonly unsubs: (() => void)[]

  constructor(doc: CollaborativeDocument, options: ConflictDetectorOptions = {}) {
    this.doc = doc
    this.opts = {
      windowMs: options.windowMs ?? 30_000,
      maxPending: options.maxPending ?? 50,
      maxConflicts: options.maxConflicts ?? 20,
      now: options.now ?? Date.now,
    }
    this.lastText = doc.text
    this.unsubs = [
      doc.onLocalOps((ops) => this.noteLocal(ops)),
      doc.onRemoteOps((ops) => this.noteRemote(ops)),
      // Keep lastText fresh across remote edits so the next local diff is
      // computed against the true previous text. Runs after onLocalOps in
      // emit() order, so noteLocal still sees the pre-edit text.
      doc.subscribe(() => {
        this.lastText = this.doc.text
      }),
    ]
  }

  dispose() {
    for (const u of this.unsubs) u()
    this.unsubs.length = 0
    this.listeners.clear()
  }

  /** Unresolved conflicts, oldest first. */
  getConflicts(): TextConflict[] {
    return [...this.conflicts]
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Apply a resolution through the CRDT and clear the conflict.
   * Returns the ops produced (for tests / callers that broadcast manually).
   */
  resolve(conflictId: string, resolution: ConflictResolution): CrdtOp[] {
    const idx = this.conflicts.findIndex((c) => c.id === conflictId)
    if (idx === -1) return []
    const [conflict] = this.conflicts.splice(idx, 1)
    const sig = this.idToSig.get(conflict.id)
    if (sig !== undefined) {
      this.idToSig.delete(conflict.id)
      this.sigToId.delete(sig)
    }

    let ops: CrdtOp[] = []
    if (resolution === "local") {
      // Remove whatever the remote side contributed.
      if (conflict.remoteIds.length) ops = this.doc.deleteByIds(conflict.remoteIds)
      if (conflict.kind === "overlapping-delete" && conflict.localText) {
        // The remote delete tombstoned our inserted text; "local" restores it.
        ops = ops.concat(this.doc.insertText(conflict.start, conflict.localText))
      }
      // For concurrent inserts/deletes the local version already stands —
      // e.g. a local deletion stays deleted.
    } else if (resolution === "remote") {
      // Remove whatever the local side inserted; deletions already stand.
      if (conflict.localIds.length) ops = this.doc.deleteByIds(conflict.localIds)
      // If the local side had deleted text the remote version still has,
      // "remote" restores it.
      if (conflict.localDeletedText) {
        ops = ops.concat(this.doc.insertText(conflict.start, conflict.localDeletedText))
      }
    }
    // "merge" keeps the CRDT's interleaved result — nothing to apply.

    this.notify()
    return ops
  }

  // ---- internals ------------------------------------------------------

  private noteLocal(ops: CrdtOp[]) {
    const now = this.opts.now()
    const prev = this.lastText
    const next = this.doc.text
    this.lastText = next
    if (prev === next && ops.length === 0) return

    // Diff prev -> next to find the touched visible range.
    let p = 0
    const maxP = Math.min(prev.length, next.length)
    while (p < maxP && prev[p] === next[p]) p++
    let s = 0
    while (
      s < Math.min(prev.length - p, next.length - p) &&
      prev[prev.length - 1 - s] === next[next.length - 1 - s]
    )
      s++
    const insertedText = next.slice(p, next.length - s)
    const deletedText = prev.slice(p, prev.length - s)

    const insertedIds: CrdtId[] = []
    const deletedIds: CrdtId[] = []
    for (const op of ops) {
      if (op.type === "insert") insertedIds.push(...SequenceCRDT.idsForInsert(op))
      else if (op.type === "delete") deletedIds.push(...op.ids)
    }

    // For pure remote-position inserts the diff may not line up with op ids
    // (e.g. replaceRange); the diff region is the source of truth for range.
    const start = p
    const end = next.length - s
    if (!insertedText && !deletedText && !insertedIds.length && !deletedIds.length) return

    this.pending.push({
      start,
      end,
      insertedIds,
      insertedText,
      deletedText,
      ts: now,
    })
    if (this.pending.length > this.opts.maxPending) {
      this.pending.splice(0, this.pending.length - this.opts.maxPending)
    }
    void deletedIds // deleted ids tracked implicitly via deletedText/range
  }

  private noteRemote(ops: CrdtOp[]) {
    const now = this.opts.now()
    this.prune(now)
    for (const op of ops) {
      if (op.type === "insert") this.checkRemoteInsert(op, now)
      else if (op.type === "delete") this.checkRemoteDelete(op, now)
      // mark ops don't produce text conflicts.
    }
  }

  private prune(now: number) {
    const cutoff = now - this.opts.windowMs
    this.pending = this.pending.filter((e) => e.ts >= cutoff)
  }

  private findLocalMatch(start: number, end: number): LocalEdit | undefined {
    // Closed-interval intersection: a remote op touching the local edit's
    // span (including its boundaries) counts as a same-range edit.
    return this.pending.find((e) => start <= e.end && end >= e.start)
  }

  private checkRemoteInsert(op: Extract<CrdtOp, { type: "insert" }>, now: number) {
    const ids = SequenceCRDT.idsForInsert(op)
    if (!ids.length) return
    const firstIdx = this.doc.crdt.indexOfId(ids[0])
    if (firstIdx === -1) return
    const start = firstIdx
    const end = start + ids.length

    const local = this.findLocalMatch(start, end)
    if (!local) return

    const insertedText = local.insertedText
    const deletedText = local.deletedText
    const isInsertConflict = insertedText.length > 0
    this.pushConflict({
      kind: "concurrent-insert",
      start: Math.min(start, local.start),
      end: Math.max(end, local.end),
      localText: insertedText || deletedText,
      remoteText: op.text,
      remoteIds: ids,
      localIds: isInsertConflict ? local.insertedIds : [],
      localDeletedText: deletedText,
      now,
      signature: `ins:${ids.map(idKey).join(",")}`,
    })
  }

  private checkRemoteDelete(op: Extract<CrdtOp, { type: "delete" }>, now: number) {
    const remoteIdSet = new Set(op.ids.map(idKey))
    for (const local of this.pending) {
      const hit = local.insertedIds.find((id) => remoteIdSet.has(idKey(id)))
      if (!hit) continue

      // Region: where the local insert used to live. The ids are tombstoned
      // now, so anchor on the first remote-deleted id's left neighbour.
      const first = op.ids[0]
      const item = first ? this.doc.crdt.getItem(first) : undefined
      let start = local.start
      if (item) {
        if (!item.leftOrigin) start = 0
        else {
          const idx = this.doc.crdt.indexOfId(item.leftOrigin)
          if (idx !== -1) start = idx + 1
        }
      }
      const width = Math.max(local.insertedText.length, 1)

      this.pushConflict({
        kind: "overlapping-delete",
        start,
        end: start + width,
        localText: local.insertedText,
        remoteText: "",
        remoteIds: [],
        localIds: local.insertedIds,
        localDeletedText: "",
        now,
        signature: `del:${op.ids.map(idKey).join(",")}`,
      })
      return // one conflict per remote delete batch is enough
    }
  }

  private pushConflict(args: {
    kind: ConflictKind
    start: number
    end: number
    localText: string
    remoteText: string
    remoteIds: CrdtId[]
    localIds: CrdtId[]
    localDeletedText: string
    now: number
    signature: string
  }) {
    // Dedupe: same remote contribution already surfaced.
    if (this.sigToId.has(args.signature)) return
    const id = `c${++this.seq}`
    this.sigToId.set(args.signature, id)
    this.idToSig.set(id, args.signature)
    this.conflicts.push({
      id,
      kind: args.kind,
      start: Math.max(0, args.start),
      end: Math.max(args.start, args.end),
      localText: args.localText,
      remoteText: args.remoteText,
      createdAt: args.now,
      remoteIds: args.remoteIds,
      localIds: args.localIds,
      localDeletedText: args.localDeletedText,
    })
    if (this.conflicts.length > this.opts.maxConflicts) {
      const excess = this.conflicts.length - this.opts.maxConflicts
      for (const c of this.conflicts.splice(0, excess)) {
        const s = this.idToSig.get(c.id)
        if (s !== undefined) {
          this.idToSig.delete(c.id)
          this.sigToId.delete(s)
        }
      }
    }
    this.notify()
  }

  private notify() {
    for (const l of this.listeners) l()
  }
}
