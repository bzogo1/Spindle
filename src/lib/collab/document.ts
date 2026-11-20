import { SequenceCRDT, type CrdtId, type CrdtOp } from "./crdt"

/**
 * Document model wrapping the sequence CRDT.
 *
 * `CollaborativeDoc` owns one CRDT, turns local edits into ops (which the
 * caller distributes via `onOp` / a sync connection), and applies remote
 * ops from peers. Works for chat messages and shared docs alike — the unit
 * is a linear sequence of characters.
 */
export interface DocSnapshot {
  text: string
  /** Visible item ids in order (stable positions for caret mapping). */
  ids: CrdtId[]
}

export class CollaborativeDocument {
  readonly crdt: SequenceCRDT
  private readonly listeners = new Set<(ops: CrdtOp[]) => void>()
  private readonly anyListeners = new Set<() => void>()
  private readonly remoteListeners = new Set<(ops: CrdtOp[]) => void>()

  constructor(clientId: string, initialText = "") {
    this.crdt = new SequenceCRDT(clientId)
    if (initialText) {
      // Seed content as ordinary local ops so it syncs to peers.
      const op = this.crdt.createInsertOp(0, initialText)
      if (op) this.emit([op])
    }
  }

  get text(): string {
    return this.crdt.getText()
  }

  get length(): number {
    return this.crdt.length
  }

  snapshot(): DocSnapshot {
    return { text: this.crdt.getText(), ids: this.crdt.getVisibleIds() }
  }

  getStateVector() {
    return this.crdt.getStateVector()
  }

  /**
   * Replace the range [start, end) with `text`, producing the minimal
   * delete+insert op pair and applying it locally.
   */
  replaceRange(start: number, end: number, text: string): CrdtOp[] {
    const ops: CrdtOp[] = []
    const del = this.crdt.createDeleteOp(start, Math.max(0, end - start))
    if (del) ops.push(del)
    const ins = this.crdt.createInsertOp(start, text)
    if (ins) ops.push(ins)
    if (ops.length) this.emit(ops)
    return ops
  }

  insertText(index: number, text: string): CrdtOp[] {
    return this.replaceRange(index, index, text)
  }

  deleteRange(start: number, end: number): CrdtOp[] {
    const op = this.crdt.createDeleteOp(start, end - start)
    if (!op) return []
    this.emit([op])
    return [op]
  }

  /**
   * Delete an explicit set of item ids — used by conflict resolution to
   * remove one side's contribution regardless of where it sits.
   */
  deleteByIds(ids: CrdtId[]): CrdtOp[] {
    const op = this.crdt.createDeleteByIdsOp(ids)
    if (!op) return []
    this.emit([op])
    return [op]
  }

  /**
   * Set a formatting mark (`key` → `value`, null removes) on the visible
   * range [start, end). Marks merge per-character via last-writer-wins.
   */
  setMark(
    start: number,
    end: number,
    key: string,
    value: string | null,
    ts?: number,
    by?: string,
  ): CrdtOp[] {
    const op = this.crdt.createMarkOp(start, Math.max(0, end - start), key, value, ts, by)
    if (!op) return []
    this.emit([op])
    return [op]
  }

  /** Marks applied to the visible item at `index` (empty object if none). */
  getMarksAt(index: number): Record<string, string> {
    const id = this.crdt.getIdAt(index)
    const item = id ? this.crdt.getItem(id) : undefined
    const out: Record<string, string> = {}
    for (const [k, m] of Object.entries(item?.marks ?? {})) {
      if (!m.deleted) out[k] = m.value
    }
    return out
  }

  /** Marks for every visible character, aligned with `snapshot().ids`. */
  getVisibleMarks(): (Record<string, string> | null)[] {
    return this.crdt.getVisibleIds().map((id) => {
      const item = this.crdt.getItem(id)
      if (!item?.marks) return null
      const out: Record<string, string> = {}
      for (const [k, m] of Object.entries(item.marks)) {
        if (!m.deleted) out[k] = m.value
      }
      return Object.keys(out).length ? out : null
    })
  }

  /** Apply remote ops. Emits nothing (echo prevention is the caller's job). */
  applyRemoteOps(ops: CrdtOp[]): boolean {
    let changed = false
    for (const op of ops) {
      if (this.crdt.applyOp(op)) changed = true
    }
    if (changed) {
      this.notifyRemoteChanged()
      for (const l of this.remoteListeners) l(ops)
    }
    return changed
  }

  /** Subscribe to *any* state change (local or remote). Returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.anyListeners.add(listener)
    return () => this.anyListeners.delete(listener)
  }

  /**
   * Subscribe to locally-generated ops. Returns unsubscribe.
   * Remote ops applied via applyRemoteOps do not trigger this.
   */
  onLocalOps(listener: (ops: CrdtOp[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Subscribe to remote op batches (applied via applyRemoteOps and
   * actually changed state). Used by conflict detection.
   */
  onRemoteOps(listener: (ops: CrdtOp[]) => void): () => void {
    this.remoteListeners.add(listener)
    return () => this.remoteListeners.delete(listener)
  }

  private emit(ops: CrdtOp[]) {
    for (const l of this.listeners) l(ops)
    for (const l of this.anyListeners) l()
  }

  /** Notify generic subscribers after remote ops were applied. */
  notifyRemoteChanged() {
    for (const l of this.anyListeners) l()
  }
}
