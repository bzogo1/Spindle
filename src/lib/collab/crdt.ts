/**
 * Sequence CRDT for collaborative text editing.
 *
 * Implements an RGA/YATA-style list CRDT:
 * - Every inserted character is an "item" identified by a Lamport-style id
 *   `{ client, clock }` where `clock` is a per-client monotonically increasing
 *   counter (the client's "state vector" entry).
 * - An insert op declares `leftOrigin` — the id of the item the new text was
 *   typed after (null = document start).
 * - Items form a tree; document order is a depth-first pre-order traversal
 *   where siblings are ordered by *decreasing* id (newest first). Because the
 *   ordering only depends on the op payload (ids + leftOrigin) and not on
 *   delivery order, replicas converge regardless of how ops are shuffled.
 * - Deletes are tombstones: they never change tree structure, so concurrent
 *   insert/delete commute.
 *
 * Ops are plain JSON-serialisable objects and safe to send over any transport.
 */

export interface CrdtId {
  /** Stable identifier of the replica that produced the item. */
  client: string
  /** Per-client counter; unique per item and monotonic. */
  clock: number
}

export interface CrdtItem extends CrdtId {
  char: string
  leftOrigin: CrdtId | null
  deleted: boolean
  /**
   * Formatting marks keyed by attribute name (e.g. "bold", "italic").
   * Values are last-writer-wins per (item, key) ordered by (ts, ord),
   * so concurrent mark ops converge deterministically regardless of
   * delivery order. Entries with `deleted: true` are tombstones: they
   * still participate in the (ts, ord) ordering so an unmark beats older
   * marks delivered late, but are never rendered.
   */
  marks?: Record<string, { value: string; ts: number; ord: string; deleted?: boolean }>
}

export type CrdtOp =
  | {
      type: "insert"
      /** Id of the first inserted character. */
      id: CrdtId
      /** Id of the item the text was inserted after (null = start). */
      leftOrigin: CrdtId | null
      /** Characters inserted; item i has id { client: id.client, clock: id.clock + i }. */
      text: string
    }
  | {
      type: "delete"
      /** Ids of the items to tombstone. */
      ids: CrdtId[]
    }
  | {
      type: "mark"
      /** Ids of the items to (un)mark. */
      ids: CrdtId[]
      /** Attribute name, e.g. "bold". */
      key: string
      /** Mark value; null removes the attribute. */
      value: string | null
      /**
       * Lamport-ish timestamp for last-writer-wins per (item, key).
       * Larger ts wins; ties are broken deterministically by `ord`
       * (derived from the op's first id + value), so replicas agree
       * regardless of delivery order.
       */
      ts: number
      /**
       * Deterministic tie-breaker for equal `ts` values (typically the
       * authoring client's id). Combined with the mark value into `ord`
       * so concurrent marks with identical timestamps resolve identically
       * on every replica regardless of delivery order. Optional for
       * backwards compatibility — falls back to the first id's client.
       */
      by?: string
    }

export type StateVector = Record<string, number>

/** Deterministic total order for sibling items: newer (larger clock) first,
 *  ties broken by client id so all replicas agree. */
function compareIdsDesc(a: CrdtId, b: CrdtId): number {
  if (a.clock !== b.clock) return b.clock - a.clock
  if (a.client === b.client) return 0
  return a.client < b.client ? 1 : -1
}

function sameId(a: CrdtId, b: CrdtId): boolean {
  return a.client === b.client && a.clock === b.clock
}

function idKey(id: CrdtId): string {
  return `${id.client}:${id.clock}`
}

export class SequenceCRDT {
  readonly clientId: string
  private readonly items = new Map<string, CrdtItem>()
  /** Highest clock this replica has locally allocated + 1. */
  private nextClock = 0
  /** Highest clock seen per remote client (for state vectors). */
  private readonly clocks = new Map<string, number>()
  /**
   * Tombstones for ids whose delete op arrived before the insert (out-of-
   * order delivery). Consulted when materialising later inserts.
   */
  private readonly deletedIds = new Set<string>()
  /**
   * Marks for ids whose mark op arrived before the insert (out-of-order
   * delivery), keyed by item id then mark key. `value: null` entries are
   * unmark tombstones — they must be buffered too, otherwise a later
   * unmark loses to an earlier buffered mark on some replicas.
   */
  private readonly pendingMarks = new Map<
    string,
    Record<string, { value: string | null; ts: number; ord: string }>
  >()

  constructor(clientId: string) {
    if (!clientId) throw new Error("SequenceCRDT requires a clientId")
    this.clientId = clientId
  }

  /** Allocate the next local id. Call once per inserted character. */
  private allocId(): CrdtId {
    return { client: this.clientId, clock: this.nextClock++ }
  }

  /** Current state vector: highest clock seen per client. */
  getStateVector(): StateVector {
    const sv: StateVector = { ...Object.fromEntries(this.clocks) }
    sv[this.clientId] = Math.max(sv[this.clientId] ?? 0, this.nextClock)
    return sv
  }

  /** Number of non-deleted items known to this replica. */
  get length(): number {
    return this.getVisibleItems().length
  }

  /**
   * Visible (non-deleted) items in document order.
   *
   * PERF NOTE: every call rebuildes the children index and walks all items
   * — O(items) per invocation. `getText`/`getVisibleIds`/`length` each call
   * this, so a keystroke costs several O(n) passes. Acceptable for typical
   * documents (≲10k chars); a perf backlog item is an incremental/indexed
   * materialisation if profiling shows it matters.
   */
  getVisibleItems(): CrdtItem[] {
    // Build children lists: parent key -> items, sorted deterministically.
    const children = new Map<string, CrdtItem[]>()
    for (const item of this.items.values()) {
      const key = item.leftOrigin ? idKey(item.leftOrigin) : ""
      const list = children.get(key)
      if (list) list.push(item)
      else children.set(key, [item])
    }
    for (const list of children.values()) {
      list.sort((a, b) => compareIdsDesc(a, b))
    }

    // Iterative pre-order DFS — a recursive walk overflows the stack on
    // long linear leftOrigin chains (e.g. a single large paste).
    const out: CrdtItem[] = []
    const stack: { list: CrdtItem[]; index: number }[] = []
    const root = children.get("")
    if (root) stack.push({ list: root, index: 0 })
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.index >= top.list.length) {
        stack.pop()
        continue
      }
      const item = top.list[top.index++]
      out.push(item)
      const childList = children.get(idKey(item))
      if (childList && childList.length > 0) {
        stack.push({ list: childList, index: 0 })
      }
    }
    return out
  }

  getText(): string {
    return this.getVisibleItems()
      .filter((i) => !i.deleted)
      .map((i) => i.char)
      .join("")
  }

  /** Visible item ids in order — used by the document layer. */
  getVisibleIds(): CrdtId[] {
    return this.getVisibleItems()
      .filter((i) => !i.deleted)
      .map((i) => ({ client: i.client, clock: i.clock }))
  }

  /** Id of the item at `index` in the visible sequence (null if out of range). */
  getIdAt(index: number): CrdtId | null {
    const visible = this.getVisibleIds()
    if (index < 0 || index >= visible.length) return null
    return visible[index]
  }

  /** Index of `id` in the visible sequence, or -1 if unknown/deleted. */
  indexOfId(id: CrdtId): number {
    const visible = this.getVisibleIds()
    return visible.findIndex((v) => sameId(v, id))
  }

  /** Raw item lookup (includes tombstoned items). */
  getItem(id: CrdtId): CrdtItem | undefined {
    return this.items.get(idKey(id))
  }

  /** Concatenated characters for `ids` (tombstoned chars still report). */
  textForIds(ids: CrdtId[]): string {
    let out = ""
    for (const id of ids) {
      const item = this.items.get(idKey(id))
      if (item) out += item.char
    }
    return out
  }

  /** Item ids covered by an insert op (id + text.length - 1 clocks). */
  static idsForInsert(op: Extract<CrdtOp, { type: "insert" }>): CrdtId[] {
    const ids: CrdtId[] = []
    for (let k = 0; k < op.text.length; k++) {
      ids.push({ client: op.id.client, clock: op.id.clock + k })
    }
    return ids
  }

  /**
   * leftOrigin for inserting at visible position `index`: the id of the
   * last visible item before the position (null at index 0).
   */
  leftOriginAt(index: number): CrdtId | null {
    if (index <= 0) return null
    return this.getIdAt(index - 1)
  }

  /**
   * Build an insert op for `text` at visible position `index` and apply it
   * locally. Returns null if the text is empty. Caller owns distribution.
   */
  createInsertOp(index: number, text: string): Extract<CrdtOp, { type: "insert" }> | null {
    if (text.length === 0) return null
    // Clamp to the document bounds — an out-of-range index must append at
    // the end, not silently collapse to leftOrigin=null (doc start).
    const clamped = Math.max(0, Math.min(index, this.length))
    const leftOrigin = this.leftOriginAt(clamped)
    const op: Extract<CrdtOp, { type: "insert" }> = {
      type: "insert",
      id: this.allocId(),
      leftOrigin,
      text,
    }
    this.applyOp(op)
    return op
  }

  /**
   * Build a delete op removing `count` visible characters starting at
   * `index`, and apply it locally. Returns null if nothing to delete.
   */
  createDeleteOp(index: number, count: number): Extract<CrdtOp, { type: "delete" }> | null {
    const visible = this.getVisibleIds()
    const ids = visible.slice(index, index + count)
    if (ids.length === 0) return null
    const op: Extract<CrdtOp, { type: "delete" }> = { type: "delete", ids }
    this.applyOp(op)
    return op
  }

  /**
   * Build a delete op for an explicit set of item ids (used by conflict
   * resolution to remove a specific side's contribution). Applies locally.
   * Ids that are unknown or already tombstoned are filtered out.
   */
  createDeleteByIdsOp(ids: CrdtId[]): Extract<CrdtOp, { type: "delete" }> | null {
    const valid = ids.filter((id) => {
      const item = this.items.get(idKey(id))
      return item !== undefined && !item.deleted
    })
    if (valid.length === 0) return null
    const op: Extract<CrdtOp, { type: "delete" }> = { type: "delete", ids: valid }
    this.applyOp(op)
    return op
  }

  /**
   * Build a mark op setting `key` to `value` (null removes) on the `count`
   * visible items starting at `index`, and apply it locally.
   */
  createMarkOp(
    index: number,
    count: number,
    key: string,
    value: string | null,
    ts = Date.now(),
    by = this.clientId,
  ): Extract<CrdtOp, { type: "mark" }> | null {
    if (!key || count <= 0) return null
    const ids = this.getVisibleIds().slice(index, index + count)
    if (ids.length === 0) return null
    const op: Extract<CrdtOp, { type: "mark" }> = { type: "mark", ids, key, value, ts, by }
    this.applyOp(op)
    return op
  }

  /**
   * Apply a remote (or local echo) op. Returns true if the op changed state.
   * Idempotent: duplicate ops are ignored.
   */
  applyOp(op: CrdtOp): boolean {
    if (op.type === "insert") {
      if (!op.text) return false
      const firstClock = op.id.clock
      const lastClock = firstClock + op.text.length - 1
      // Duplicate or overlapping insert — ignore if any char already exists.
      for (let k = 0; k < op.text.length; k++) {
        const id = { client: op.id.client, clock: firstClock + k }
        if (this.items.has(idKey(id))) return false
      }
      for (let k = 0; k < op.text.length; k++) {
        const id = { client: op.id.client, clock: firstClock + k }
        const key = idKey(id)
        const item: CrdtItem = {
          client: id.client,
          clock: id.clock,
          char: op.text[k],
          leftOrigin: k === 0 ? op.leftOrigin : { client: op.id.client, clock: firstClock + k - 1 },
          deleted: this.deletedIds.has(key),
        }
        // Materialise marks that arrived before this insert (out-of-order).
        // Skipped on tombstoned items — matching the in-order path where a
        // mark op on a deleted item is ignored — so replicas converge.
        const pending = this.pendingMarks.get(key)
        if (pending) {
          if (!item.deleted) {
            const marks: NonNullable<CrdtItem["marks"]> = {}
            for (const [mk, m] of Object.entries(pending)) {
              marks[mk] =
                m.value === null
                  ? { value: "", ts: m.ts, ord: m.ord, deleted: true }
                  : { value: m.value, ts: m.ts, ord: m.ord }
            }
            item.marks = marks
          }
          this.pendingMarks.delete(key)
        }
        this.items.set(key, item)
      }
      this.noteClock(op.id.client, lastClock)
      return true
    }

    if (op.type === "mark") {
      if (!op.key) return false
      // Deterministic order key for equal timestamps: derived purely from
      // the op payload so every replica computes the same winner.
      // JSON-encoding keeps "" and null distinct — a plain `${by}:${value}`
      // would collide them and let delivery order decide the winner.
      const by = op.by ?? op.ids[0]?.client ?? ""
      const ord = JSON.stringify([by, op.value])
      const wins = (existing: { ts: number; ord: string } | undefined): boolean => {
        if (!existing) return true
        if (op.ts !== existing.ts) return op.ts > existing.ts
        return ord > existing.ord
      }
      let changed = false
      for (const id of op.ids) {
        const key = idKey(id)
        const item = this.items.get(key)
        if (!item) {
          // Item hasn't arrived yet — buffer the mark. Unmark (null) ops
          // are buffered as tombstones too: without them a replica that
          // sees [mark, unmark, insert] out of order would resurrect the
          // mark when the insert materialises.
          let perItem = this.pendingMarks.get(key)
          if (!perItem) {
            perItem = {}
            this.pendingMarks.set(key, perItem)
          }
          const existing = perItem[op.key]
          if (wins(existing)) {
            perItem[op.key] = { value: op.value, ts: op.ts, ord }
          }
          continue
        }
        if (item.deleted) continue
        const existing = item.marks?.[op.key]
        if (!wins(existing)) continue
        const marks = { ...(item.marks ?? {}) }
        // Unmark writes a tombstone rather than deleting the entry, so a
        // subsequently delivered older mark loses the (ts, ord) compare.
        marks[op.key] =
          op.value === null
            ? { value: "", ts: op.ts, ord, deleted: true }
            : { value: op.value, ts: op.ts, ord }
        item.marks = marks
        changed = true
      }
      return changed
    }

    // delete — record tombstones even for items not yet received so that
    // out-of-order delivery still converges.
    let changed = false
    for (const id of op.ids) {
      const key = idKey(id)
      this.deletedIds.add(key)
      const item = this.items.get(key)
      if (item && !item.deleted) {
        item.deleted = true
        changed = true
      }
      this.noteClock(id.client, id.clock)
    }
    return changed
  }

  /**
   * Whether the replica has seen all ops implied by `stateVector`.
   * Missing ops must be fetched before catch-up is considered complete.
   */
  missingSince(stateVector: StateVector): boolean {
    for (const [client, clock] of Object.entries(stateVector)) {
      const known = client === this.clientId ? this.nextClock : (this.clocks.get(client) ?? 0)
      if (known < clock) return true
    }
    return false
  }

  private noteClock(client: string, clock: number) {
    if (client === this.clientId) {
      this.nextClock = Math.max(this.nextClock, clock + 1)
    }
    this.clocks.set(client, Math.max(this.clocks.get(client) ?? 0, clock + 1))
  }
}

/** Shallow-structural equality of two CRDT states (for tests). */
export function sameIdList(a: CrdtId[], b: CrdtId[]): boolean {
  return a.length === b.length && a.every((id, i) => sameId(id, b[i]))
}
