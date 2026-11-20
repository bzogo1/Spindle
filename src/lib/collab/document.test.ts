import { describe, expect, it, vi } from "vitest"
import { CollaborativeDocument } from "./document"
import type { CrdtOp } from "./crdt"

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("CollaborativeDocument", () => {
  it("seeds initial text and exposes it via snapshot", () => {
    const doc = new CollaborativeDocument("a", "hello")
    const snap = doc.snapshot()
    expect(snap.text).toBe("hello")
    expect(snap.ids).toHaveLength(5)
    expect(doc.text).toBe("hello")
    expect(doc.length).toBe(5)
  })

  it("replaceRange emits a delete op followed by an insert op", () => {
    const doc = new CollaborativeDocument("a", "hello")
    const emitted: CrdtOp[][] = []
    doc.onLocalOps((ops) => emitted.push(ops))

    const ops = doc.replaceRange(1, 4, "i")
    expect(ops.map((o) => o.type)).toEqual(["delete", "insert"])
    expect(doc.text).toBe("hio")
    // One emit call carrying both ops.
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toHaveLength(2)
  })

  it("replaceRange with empty text only deletes", () => {
    const doc = new CollaborativeDocument("a", "hello")
    const ops = doc.replaceRange(1, 4, "")
    expect(ops.map((o) => o.type)).toEqual(["delete"])
    expect(doc.text).toBe("ho")
  })

  it("replaceRange with end <= start behaves as a pure insert", () => {
    const doc = new CollaborativeDocument("a", "ac")
    const ops = doc.replaceRange(1, 1, "b")
    expect(ops.map((o) => o.type)).toEqual(["insert"])
    expect(doc.text).toBe("abc")
  })

  it("deleteRange removes visible characters and returns the op", () => {
    const doc = new CollaborativeDocument("a", "abcdef")
    const ops = doc.deleteRange(1, 4)
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe("delete")
    expect(doc.text).toBe("aef")
  })

  it("deleteRange out of range returns [] and emits nothing", () => {
    const doc = new CollaborativeDocument("a", "ab")
    const listener = vi.fn()
    doc.onLocalOps(listener)
    const anyListener = vi.fn()
    doc.subscribe(anyListener)

    expect(doc.deleteRange(5, 9)).toEqual([])
    expect(doc.deleteRange(2, 1)).toEqual([]) // negative count → nothing
    expect(listener).not.toHaveBeenCalled()
    expect(anyListener).not.toHaveBeenCalled()
    expect(doc.text).toBe("ab")
  })

  it("insertText is a replaceRange alias producing one insert op", () => {
    const doc = new CollaborativeDocument("a")
    const ops = doc.insertText(0, "hi")
    expect(ops.map((o) => o.type)).toEqual(["insert"])
    expect(doc.text).toBe("hi")
  })

  it("snapshot ids stay aligned with text length after mixed edits", () => {
    const doc = new CollaborativeDocument("a", "hello world")
    doc.deleteRange(0, 6)
    doc.insertText(0, "goodbye ")
    const snap = doc.snapshot()
    expect(snap.text).toBe("goodbye world")
    expect(snap.ids).toHaveLength(snap.text.length)
  })

  it("onLocalOps does not fire for remote ops; subscribe does", async () => {
    const a = new CollaborativeDocument("a")
    const b = new CollaborativeDocument("b")

    const localOps = vi.fn()
    const anyA = vi.fn()
    a.onLocalOps(localOps)
    a.subscribe(anyA)

    // Simulate a remote edit authored on b and delivered to a.
    const remoteOps = b.insertText(0, "remote")
    const changed = a.applyRemoteOps(remoteOps)

    expect(changed).toBe(true)
    expect(a.text).toBe("remote")
    expect(localOps).not.toHaveBeenCalled()
    expect(anyA).toHaveBeenCalledTimes(1)
  })

  it("applyRemoteOps is idempotent: duplicates report no change and don't notify", () => {
    const a = new CollaborativeDocument("a")
    const b = new CollaborativeDocument("b")
    const remoteOps = b.insertText(0, "x")

    const anyA = vi.fn()
    a.subscribe(anyA)
    expect(a.applyRemoteOps(remoteOps)).toBe(true)
    expect(anyA).toHaveBeenCalledTimes(1)

    expect(a.applyRemoteOps(remoteOps)).toBe(false)
    expect(a.applyRemoteOps([])).toBe(false)
    expect(anyA).toHaveBeenCalledTimes(1)
    expect(a.text).toBe("x")
  })

  it("unsubscribe stops both listener kinds", () => {
    const doc = new CollaborativeDocument("a")
    const localOps = vi.fn()
    const any = vi.fn()
    const unsubLocal = doc.onLocalOps(localOps)
    const unsubAny = doc.subscribe(any)

    unsubLocal()
    unsubAny()
    doc.insertText(0, "z")
    expect(localOps).not.toHaveBeenCalled()
    expect(any).not.toHaveBeenCalled()
  })

  it("two documents converge when ops are exchanged both ways", async () => {
    const a = new CollaborativeDocument("a")
    const b = new CollaborativeDocument("b")

    const wire: { from: CollaborativeDocument; ops: CrdtOp[] }[] = []
    a.onLocalOps((ops) => wire.push({ from: a, ops }))
    b.onLocalOps((ops) => wire.push({ from: b, ops }))

    a.insertText(0, "alpha ")
    b.insertText(0, "beta ")
    a.deleteRange(0, 3)
    b.insertText(5, "!")

    // Deliver everything to both replicas — the CRDT ignores duplicates,
    // so a replica applying its own ops again is a no-op.
    const delivered: CrdtOp[] = []
    for (const m of wire) delivered.push(...m.ops)
    a.applyRemoteOps(delivered)
    b.applyRemoteOps(delivered)

    await flush()
    expect(a.text).toBe(b.text)
    expect(a.snapshot().ids).toEqual(b.snapshot().ids)
  })
})

describe("CollaborativeDocument marks & id ops", () => {
  it("setMark emits a mark op and exposes marks per visible char", () => {
    const doc = new CollaborativeDocument("a", "hello")
    const emitted: CrdtOp[][] = []
    doc.onLocalOps((ops) => emitted.push(ops))

    const ops = doc.setMark(1, 4, "bold", "true", 42)
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe("mark")
    expect(emitted).toHaveLength(1)

    expect(doc.getMarksAt(0)).toEqual({})
    expect(doc.getMarksAt(2)).toEqual({ bold: "true" })
    const marks = doc.getVisibleMarks()
    expect(marks).toHaveLength(5)
    expect(marks[1]).toEqual({ bold: "true" })
    expect(marks[4]).toBeNull()
  })

  it("setMark with empty range emits nothing", () => {
    const doc = new CollaborativeDocument("a", "hi")
    const listener = vi.fn()
    doc.onLocalOps(listener)
    expect(doc.setMark(1, 1, "bold", "true")).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })

  it("remote mark ops apply and converge", () => {
    const c = new CollaborativeDocument("c")
    const d = new CollaborativeDocument("d")
    const wire: CrdtOp[] = []
    c.onLocalOps((ops) => wire.push(...ops))
    c.insertText(0, "ab")
    d.applyRemoteOps(wire)

    const markOps = c.setMark(0, 2, "underline", "yes", 5)
    d.applyRemoteOps(markOps)
    expect(d.getMarksAt(0)).toEqual({ underline: "yes" })
    expect(d.getMarksAt(1)).toEqual({ underline: "yes" })
  })

  it("deleteByIds removes specific items and emits ops", () => {
    const doc = new CollaborativeDocument("a", "abc")
    const snap = doc.snapshot()
    const ops = doc.deleteByIds([snap.ids[0], snap.ids[2]])
    expect(ops).toHaveLength(1)
    expect(ops[0].type).toBe("delete")
    expect(doc.text).toBe("b")
    // Unknown ids → no-op.
    expect(doc.deleteByIds([{ client: "ghost", clock: 0 }])).toEqual([])
  })

  it("onRemoteOps fires only for remote batches that changed state", () => {
    const a = new CollaborativeDocument("a")
    const b = new CollaborativeDocument("b")
    const seen: CrdtOp[][] = []
    a.onRemoteOps((ops) => seen.push(ops))

    const ops = b.insertText(0, "hi")
    a.applyRemoteOps(ops)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(ops)

    a.applyRemoteOps(ops) // duplicate — ignored
    expect(seen).toHaveLength(1)

    const unsub = a.onRemoteOps(() => {})
    unsub()
  })
})
