import { describe, expect, it } from "vitest"
import { SequenceCRDT, sameIdList, type CrdtOp } from "./crdt"
import { CollaborativeDocument } from "./document"

/** Deterministic PRNG (mulberry32) for reproducible random op streams. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const CHARS = "abcde"

/** Generate a random op stream on `doc`, collecting emitted ops. */
function randomEdits(doc: CollaborativeDocument, rand: () => number, steps: number): CrdtOp[] {
  const ops: CrdtOp[] = []
  const unsub = doc.onLocalOps((o) => ops.push(...o))
  for (let i = 0; i < steps; i++) {
    const len = doc.length
    if (len === 0 || rand() < 0.6) {
      const pos = Math.floor(rand() * (len + 1))
      const text = CHARS[Math.floor(rand() * CHARS.length)]
      doc.insertText(pos, text)
    } else {
      const pos = Math.floor(rand() * len)
      const count = 1 + Math.floor(rand() * Math.min(3, len - pos))
      doc.deleteRange(pos, pos + count)
    }
  }
  unsub()
  return ops
}

describe("SequenceCRDT convergence", () => {
  it("converges under shuffled op delivery", () => {
    const randA = rng(42)
    const randB = rng(1337)
    const docA = new CollaborativeDocument("client-a")
    const docB = new CollaborativeDocument("client-b")

    // Shared seed content, captured as ops (as if synced earlier).
    const seedDoc = new CollaborativeDocument("client-seed")
    const seed: CrdtOp[] = []
    seedDoc.onLocalOps((o) => seed.push(...o))
    seedDoc.insertText(0, "hello world")

    const opsA = randomEdits(docA, randA, 60)
    const opsB = randomEdits(docB, randB, 60)
    const allOps = [...seed, ...opsA, ...opsB]

    // Reference replica applies everything in causal order.
    const ref = new SequenceCRDT("ref")
    for (const op of allOps) ref.applyOp(op)

    // Two replicas apply the same ops in two different shuffles.
    const r1 = new SequenceCRDT("r1")
    const r2 = new SequenceCRDT("r2")
    const order1 = shuffle(allOps, rng(7))
    const order2 = shuffle(allOps, rng(99))
    for (const op of order1) r1.applyOp(op)
    for (const op of order2) r2.applyOp(op)

    expect(r1.getText()).toBe(ref.getText())
    expect(r2.getText()).toBe(ref.getText())
    expect(r1.getVisibleIds()).toEqual(ref.getVisibleIds())
    expect(r2.getVisibleIds()).toEqual(ref.getVisibleIds())

    // State vectors agree too.
    const sv = ref.getStateVector()
    for (const [client, clock] of Object.entries(sv)) {
      if (client === "ref") continue // ref's own id never appears on other replicas
      expect(r1.getStateVector()[client]).toBe(clock)
      expect(r2.getStateVector()[client]).toBe(clock)
    }
  })

  it("is idempotent under duplicate delivery", () => {
    const doc = new CollaborativeDocument("a", "xy")
    const ops: CrdtOp[] = []
    const u = doc.onLocalOps((o) => ops.push(...o))
    doc.insertText(1, "Z")
    u()
    const r = new SequenceCRDT("r")
    for (const op of ops) r.applyOp(op)
    const before = r.getText()
    for (const op of ops) r.applyOp(op) // redelivery
    expect(r.getText()).toBe(before)
  })

  it("delete arriving before insert still converges", () => {
    const a = new SequenceCRDT("a")
    const ins = a.createInsertOp(0, "abc")
    const b = new SequenceCRDT("b")
    // Deliver delete first (out of order).
    const delIds = ins ? [{ client: ins.id.client, clock: ins.id.clock + 1 }] : []
    b.applyOp({ type: "delete", ids: delIds })
    b.applyOp(ins!)
    expect(b.getText()).toBe("ac")
  })

  it("sequential same-client edits produce expected text", () => {
    const doc = new CollaborativeDocument("solo")
    doc.insertText(0, "ac")
    doc.insertText(1, "b")
    expect(doc.text).toBe("abc")
    doc.deleteRange(1, 2)
    expect(doc.text).toBe("ac")
  })
})

describe("SequenceCRDT invariants", () => {
  it("requires a non-empty clientId", () => {
    expect(() => new SequenceCRDT("")).toThrow()
  })

  it("getIdAt / leftOriginAt map visible positions to stable ids", () => {
    const doc = new CollaborativeDocument("a", "abc")
    expect(doc.crdt.getIdAt(0)).toEqual({ client: "a", clock: 0 })
    expect(doc.crdt.getIdAt(2)).toEqual({ client: "a", clock: 2 })
    expect(doc.crdt.getIdAt(3)).toBeNull()
    expect(doc.crdt.getIdAt(-1)).toBeNull()
    expect(doc.crdt.leftOriginAt(0)).toBeNull()
    expect(doc.crdt.leftOriginAt(2)).toEqual({ client: "a", clock: 1 })
  })

  it("createInsertOp rejects empty text; createDeleteOp rejects empty ranges", () => {
    const doc = new CollaborativeDocument("a", "ab")
    expect(doc.crdt.createInsertOp(0, "")).toBeNull()
    expect(doc.crdt.createDeleteOp(5, 3)).toBeNull()
    expect(doc.crdt.createDeleteOp(0, 0)).toBeNull()
  })

  it("missingSince reports unseen clocks per client", () => {
    const doc = new CollaborativeDocument("a")
    doc.insertText(0, "hi") // a clocks 0,1 → nextClock 2
    const remote = new SequenceCRDT("b")
    remote.applyOp({
      type: "insert",
      id: { client: "b", clock: 0 },
      leftOrigin: null,
      text: "zz",
    })
    const sv = remote.getStateVector()
    expect(doc.crdt.missingSince({ b: 2 })).toBe(true)
    expect(doc.crdt.missingSince({ b: 0 })).toBe(false)
    // Own client: missingSince uses nextClock.
    expect(doc.crdt.missingSince({ a: 2 })).toBe(false)
    expect(doc.crdt.missingSince({ a: 3 })).toBe(true)
    expect(sv.b).toBe(2)
  })

  it("applyOp returns false for duplicate inserts and already-deleted ids", () => {
    const doc = new CollaborativeDocument("a")
    const ops: CrdtOp[] = []
    const u = doc.onLocalOps((o) => ops.push(...o))
    doc.insertText(0, "xy") // clocks 0,1
    doc.insertText(2, "Z") // clock 2
    u()
    const r = new SequenceCRDT("r")
    for (const op of ops) expect(r.applyOp(op)).toBe(true)
    const ins = ops.find((o) => o.type === "insert" && o.text === "Z")!
    expect(r.applyOp(ins)).toBe(false) // exact duplicate
    const del: CrdtOp = { type: "delete", ids: [{ client: "a", clock: 0 }] }
    expect(r.applyOp(del)).toBe(true)
    expect(r.applyOp(del)).toBe(false) // already tombstoned
  })

  it("sameIdList compares id sequences element-wise", () => {
    const id = (clock: number) => ({ client: "c", clock })
    expect(sameIdList([id(0), id(1)], [id(0), id(1)])).toBe(true)
    expect(sameIdList([id(0)], [id(0), id(1)])).toBe(false)
    expect(sameIdList([id(0)], [{ client: "d", clock: 0 }])).toBe(false)
  })
})

describe("SequenceCRDT marks", () => {
  it("applies a mark op to a visible range and reports it via getItem", () => {
    const crdt = new SequenceCRDT("a")
    crdt.createInsertOp(0, "hello")
    const op = crdt.createMarkOp(1, 3, "bold", "true", 100)
    expect(op?.type).toBe("mark")

    const ids = crdt.getVisibleIds()
    expect(crdt.getItem(ids[0])?.marks).toBeUndefined()
    expect(crdt.getItem(ids[1])?.marks?.bold).toMatchObject({ value: "true", ts: 100 })
    expect(crdt.getItem(ids[3])?.marks?.bold).toMatchObject({ value: "true", ts: 100 })
    expect(crdt.getItem(ids[4])?.marks?.bold).toBeUndefined()
  })

  it("removes a mark with value null (writes a tombstone)", () => {
    const crdt = new SequenceCRDT("a")
    crdt.createInsertOp(0, "hi")
    crdt.createMarkOp(0, 2, "italic", "true", 1)
    crdt.createMarkOp(0, 2, "italic", null, 2)
    const id = crdt.getVisibleIds()[0]
    // Tombstone remains for LWW ordering but is flagged deleted.
    expect(crdt.getItem(id)?.marks?.italic?.deleted).toBe(true)
    // …and an older mark delivered afterwards still loses.
    const stale: CrdtOp = {
      type: "mark",
      ids: [id],
      key: "italic",
      value: "true",
      ts: 1,
      by: "z",
    }
    crdt.applyOp(stale)
    expect(crdt.getItem(id)?.marks?.italic?.deleted).toBe(true)
  })

  it("concurrent mark ops converge via last-writer-wins on ts", () => {
    const a = new SequenceCRDT("a")
    const b = new SequenceCRDT("b")
    const seed = a.createInsertOp(0, "xy")
    b.applyOp(seed!)

    // Both mark the same range with different values/timestamps.
    const opA = a.createMarkOp(0, 2, "bold", "yes", 100)
    const opB = b.createMarkOp(0, 2, "bold", "no", 200)
    a.applyOp(opB!)
    b.applyOp(opA!)

    const idA = a.getVisibleIds()[0]
    const idB = b.getVisibleIds()[0]
    expect(a.getItem(idA)?.marks?.bold?.value).toBe("no")
    expect(b.getItem(idB)?.marks?.bold?.value).toBe("no")
  })

  it("ignores mark ops for unknown or deleted items", () => {
    const crdt = new SequenceCRDT("a")
    crdt.createInsertOp(0, "ab")
    const ghost: CrdtOp = {
      type: "mark",
      ids: [{ client: "x", clock: 99 }],
      key: "bold",
      value: "1",
      ts: 1,
    }
    expect(crdt.applyOp(ghost)).toBe(false)
  })

  it("createDeleteByIdsOp removes exactly the given ids", () => {
    const crdt = new SequenceCRDT("a")
    crdt.createInsertOp(0, "abc")
    const ids = crdt.getVisibleIds()
    const op = crdt.createDeleteByIdsOp([ids[0], ids[2]])
    expect(op?.type).toBe("delete")
    expect(crdt.getText()).toBe("b")
    // Already-deleted/unknown ids are filtered → null when nothing valid.
    expect(crdt.createDeleteByIdsOp([ids[0]])).toBeNull()
  })

  it("indexOfId/getItem/textForIds helpers behave", () => {
    const crdt = new SequenceCRDT("a")
    crdt.createInsertOp(0, "hey")
    const ids = crdt.getVisibleIds()
    expect(crdt.indexOfId(ids[1])).toBe(1)
    expect(crdt.indexOfId({ client: "a", clock: 99 })).toBe(-1)
    expect(crdt.textForIds([ids[0], ids[2]])).toBe("hy")
    expect(
      SequenceCRDT.idsForInsert({
        type: "insert",
        id: { client: "z", clock: 7 },
        leftOrigin: null,
        text: "ab",
      }),
    ).toEqual([
      { client: "z", clock: 7 },
      { client: "z", clock: 8 },
    ])
  })
})

describe("SequenceCRDT robustness", () => {
  it("clamps out-of-range insert indexes instead of jumping to doc start", () => {
    const crdt = new SequenceCRDT("a")
    crdt.createInsertOp(0, "ab")
    crdt.createInsertOp(999, "c")
    expect(crdt.getText()).toBe("abc")
    const crdt2 = new SequenceCRDT("b")
    crdt2.createInsertOp(0, "ab")
    crdt2.createInsertOp(-5, "c")
    expect(crdt2.getText()).toBe("cab")
  })

  it("handles a very long linear leftOrigin chain without stack overflow", () => {
    const crdt = new SequenceCRDT("a")
    const n = 60_000
    crdt.createInsertOp(0, "x".repeat(n))
    expect(crdt.length).toBe(n)
    expect(crdt.getText()).toHaveLength(n)
    expect(crdt.getVisibleIds()).toHaveLength(n)
  })

  it("buffers mark ops that arrive before their insert (out-of-order)", () => {
    const a = new SequenceCRDT("a")
    const b = new SequenceCRDT("b")

    // b marks an item a hasn't seen yet.
    const earlyMark: CrdtOp = {
      type: "mark",
      ids: [{ client: "b", clock: 0 }],
      key: "bold",
      value: "true",
      ts: 10,
      by: "b",
    }
    a.applyOp(earlyMark)
    expect(a.getItem({ client: "b", clock: 0 })).toBeUndefined()

    // The insert arrives later — the buffered mark materialises.
    const ins: CrdtOp = {
      type: "insert",
      id: { client: "b", clock: 0 },
      leftOrigin: null,
      text: "x",
    }
    a.applyOp(ins)
    expect(a.getItem({ client: "b", clock: 0 })?.marks?.bold).toMatchObject({
      value: "true",
      ts: 10,
    })
    // Converges with the replica that saw insert-then-mark.
    b.applyOp(ins)
    b.applyOp(earlyMark)
    expect(b.getItem({ client: "b", clock: 0 })?.marks?.bold?.value).toBe("true")
  })

  it("breaks mark timestamp ties deterministically regardless of order", () => {
    const mk = (by: string, value: string): CrdtOp => ({
      type: "mark",
      ids: [{ client: "c", clock: 0 }],
      key: "k",
      value,
      ts: 5,
      by,
    })
    const ins: CrdtOp = {
      type: "insert",
      id: { client: "c", clock: 0 },
      leftOrigin: null,
      text: "z",
    }
    // opA (by "a", value "1") vs opB (by "b", value "2") — same ts.
    const opA = mk("a", "1")
    const opB = mk("b", "2")

    const r1 = new SequenceCRDT("r1")
    const r2 = new SequenceCRDT("r2")
    for (const r of [r1, r2]) r.applyOp(ins)
    r1.applyOp(opA)
    r1.applyOp(opB)
    r2.applyOp(opB)
    r2.applyOp(opA)

    const v1 = r1.getItem({ client: "c", clock: 0 })?.marks?.k?.value
    const v2 = r2.getItem({ client: "c", clock: 0 })?.marks?.k?.value
    expect(v1).toBe(v2)
    // ord = "b:2" > "a:1" → "b" wins on both replicas.
    expect(v1).toBe("2")
  })
})

describe("mark/unmark out-of-order convergence", () => {
  const itemId = { client: "b", clock: 0 }
  const ins: CrdtOp = {
    type: "insert",
    id: itemId,
    leftOrigin: null,
    text: "x",
  }
  const markOn: CrdtOp = {
    type: "mark",
    ids: [itemId],
    key: "bold",
    value: "true",
    ts: 100,
    by: "b",
  }
  const markOff: CrdtOp = {
    type: "mark",
    ids: [itemId],
    key: "bold",
    value: null,
    ts: 200,
    by: "b",
  }

  it("unmark buffered before insert still wins over the earlier mark", () => {
    // Replica A: all ops arrive before the insert (worst-case shuffle).
    const a = new SequenceCRDT("a")
    a.applyOp(markOn)
    a.applyOp(markOff)
    a.applyOp(ins)

    // Replica B: causal order.
    const b = new SequenceCRDT("b")
    b.applyOp(ins)
    b.applyOp(markOn)
    b.applyOp(markOff)

    // Both must agree: the unmark (ts 200) is the latest write.
    expect(a.getItem(itemId)?.marks?.bold?.deleted).toBe(true)
    expect(b.getItem(itemId)?.marks?.bold?.deleted).toBe(true)
    expect(a.getItem(itemId)?.marks).toEqual(b.getItem(itemId)?.marks)
  })

  it("converges across every delivery permutation of the three ops", () => {
    const label = (o: CrdtOp) =>
      o === ins ? "i" : o.type === "mark" && o.ts === 100 ? "on" : "off"
    // All 6 permutations.
    const perms: CrdtOp[][] = [
      [ins, markOn, markOff],
      [ins, markOff, markOn],
      [markOn, ins, markOff],
      [markOn, markOff, ins],
      [markOff, ins, markOn],
      [markOff, markOn, ins],
    ]
    const results = new Map<string, unknown>()
    for (const [i, order] of perms.entries()) {
      const r = new SequenceCRDT(`r${i}`)
      for (const op of order) r.applyOp(op)
      results.set(order.map(label).join(""), r.getItem(itemId)?.marks)
    }
    const unique = new Set(results.values().map((m) => JSON.stringify(m)))
    expect(unique.size).toBe(1)
    const marks = [...results.values()][0] as Record<string, { deleted?: boolean }>
    expect(marks.bold.deleted).toBe(true)
  })

  it("does not materialise buffered marks onto tombstoned items", () => {
    const del: CrdtOp = { type: "delete", ids: [itemId] }
    // Replica A: mark buffered, then insert arrives already tombstoned.
    const a = new SequenceCRDT("a")
    a.applyOp(markOn)
    a.applyOp(del)
    a.applyOp(ins)
    // Replica B: causal order — mark on a deleted item is ignored.
    const b = new SequenceCRDT("b")
    b.applyOp(ins)
    b.applyOp(del)
    b.applyOp(markOn)

    expect(a.getItem(itemId)?.marks).toBeUndefined()
    expect(b.getItem(itemId)?.marks).toBeUndefined()
    expect(a.getItem(itemId)?.marks).toEqual(b.getItem(itemId)?.marks)
  })
})

describe("mark ord collision (empty string vs unmark)", () => {
  const id = { client: "b", clock: 0 }
  const ins: CrdtOp = { type: "insert", id, leftOrigin: null, text: "x" }
  const markEmpty: CrdtOp = {
    type: "mark",
    ids: [id],
    key: "k",
    value: "",
    ts: 50,
    by: "b",
  }
  const unmark: CrdtOp = {
    type: "mark",
    ids: [id],
    key: "k",
    value: null,
    ts: 50,
    by: "b",
  }

  it("converges regardless of delivery order at equal ts", () => {
    const orders: CrdtOp[][] = [
      [ins, markEmpty, unmark],
      [ins, unmark, markEmpty],
      [markEmpty, unmark, ins],
      [unmark, markEmpty, ins],
      [markEmpty, ins, unmark],
      [unmark, ins, markEmpty],
    ]
    const results = orders.map((order, i) => {
      const r = new SequenceCRDT(`r${i}`)
      for (const op of order) r.applyOp(op)
      return r.getItem(id)?.marks
    })
    const unique = new Set(results.map((m) => JSON.stringify(m)))
    expect(unique.size).toBe(1)
    // ord('null') > ord('""') deterministically → unmark tombstone wins.
    expect(results[0]?.k?.deleted).toBe(true)
  })
})
