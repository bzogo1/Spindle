import { describe, expect, it, vi } from "vitest"
import { CollaborativeDocument } from "./document"
import { ConflictDetector } from "./conflict"
import type { CrdtOp } from "./crdt"

/** Two replicas converged on the same base text. */
function syncedPair(base = ""): { a: CollaborativeDocument; b: CollaborativeDocument } {
  const a = new CollaborativeDocument("a")
  const b = new CollaborativeDocument("b")
  if (base) {
    const ops: CrdtOp[] = []
    const unsub = a.onLocalOps((o) => ops.push(...o))
    a.insertText(0, base)
    unsub()
    b.applyRemoteOps(ops)
  }
  return { a, b }
}

describe("ConflictDetector", () => {
  it("flags concurrent inserts at the same position", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)

    // Local user types at the end…
    a.insertText(5, " mine")
    // …while the peer types at the same spot (concurrently).
    const remoteOps = b.insertText(5, " theirs")
    a.applyRemoteOps(remoteOps)

    const conflicts = det.getConflicts()
    expect(conflicts).toHaveLength(1)
    const c = conflicts[0]
    expect(c.kind).toBe("concurrent-insert")
    expect(c.localText).toBe(" mine")
    expect(c.remoteText).toBe(" theirs")
    expect(c.localIds.length).toBeGreaterThan(0)
    expect(c.remoteIds.length).toBeGreaterThan(0)
    det.dispose()
  })

  it("does not flag edits in distant regions", () => {
    const { a, b } = syncedPair("hello world")
    const det = new ConflictDetector(a)

    a.insertText(0, "A") // local edit at start
    const remoteOps = b.insertText(11, "Z") // remote edit at end
    a.applyRemoteOps(remoteOps)

    expect(det.getConflicts()).toHaveLength(0)
    det.dispose()
  })

  it("resolve 'local' removes the remote contribution via CRDT ops", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)

    a.insertText(5, " mine")
    a.applyRemoteOps(b.insertText(5, " theirs"))

    const [c] = det.getConflicts()
    const ops = det.resolve(c.id, "local")
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every((o) => o.type === "delete")).toBe(true)
    expect(a.text).toContain("mine")
    expect(a.text).not.toContain("theirs")
    expect(det.getConflicts()).toHaveLength(0)
    det.dispose()
  })

  it("resolve 'remote' removes the local contribution", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)

    a.insertText(5, " mine")
    a.applyRemoteOps(b.insertText(5, " theirs"))

    const [c] = det.getConflicts()
    det.resolve(c.id, "remote")
    expect(a.text).toContain("theirs")
    expect(a.text).not.toContain("mine")
    det.dispose()
  })

  it("resolve 'merge' keeps both sides as the CRDT interleaved them", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)

    a.insertText(5, " mine")
    const before = a.text
    a.applyRemoteOps(b.insertText(5, " theirs"))
    const merged = a.text
    expect(merged).not.toBe(before)

    const [c] = det.getConflicts()
    const ops = det.resolve(c.id, "merge")
    expect(ops).toEqual([])
    expect(a.text).toBe(merged)
    expect(a.text).toContain("mine")
    expect(a.text).toContain("theirs")
    expect(det.getConflicts()).toHaveLength(0)
    det.dispose()
  })

  it("flags a remote delete of locally inserted text (overlapping-delete)", () => {
    const { a, b } = syncedPair("hi")
    const det = new ConflictDetector(a)

    // Local inserts "XY"; peer receives it then deletes the same range.
    const localOps = a.insertText(2, "XY")
    b.applyRemoteOps(localOps)
    const delOps = b.deleteRange(2, 4)
    a.applyRemoteOps(delOps)

    const conflicts = det.getConflicts()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].kind).toBe("overlapping-delete")
    expect(conflicts[0].localText).toBe("XY")

    // "local" restores the deleted text.
    det.resolve(conflicts[0].id, "local")
    expect(a.text).toContain("XY")
    det.dispose()
  })

  it("overlapping-delete 'remote' keeps the deletion", () => {
    const { a, b } = syncedPair("hi")
    const det = new ConflictDetector(a)

    const localOps = a.insertText(2, "XY")
    b.applyRemoteOps(localOps)
    a.applyRemoteOps(b.deleteRange(2, 4))

    const [c] = det.getConflicts()
    det.resolve(c.id, "remote")
    expect(a.text).not.toContain("XY")
    det.dispose()
  })

  it("dedupes repeated delivery of the same remote ops", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)

    a.insertText(5, " mine")
    const remoteOps = b.insertText(5, " theirs")
    a.applyRemoteOps(remoteOps)
    a.applyRemoteOps(remoteOps) // duplicate — CRDT ignores, no re-notify

    expect(det.getConflicts()).toHaveLength(1)
    det.dispose()
  })

  it("expires pending local edits after the conflict window", () => {
    let t = 1_000
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a, { windowMs: 100, now: () => t })

    a.insertText(5, " mine")
    t += 500 // outside the window
    a.applyRemoteOps(b.insertText(5, " theirs"))

    expect(det.getConflicts()).toHaveLength(0)
    det.dispose()
  })

  it("notifies listeners when conflicts appear and resolve", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)
    const onChange = vi.fn()
    det.onChange(onChange)

    a.insertText(5, " mine")
    a.applyRemoteOps(b.insertText(5, " theirs"))
    expect(onChange).toHaveBeenCalled()

    const [c] = det.getConflicts()
    det.resolve(c.id, "merge")
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2)
    det.dispose()
  })

  it("dispose unsubscribes from the document", () => {
    const { a, b } = syncedPair("hello")
    const det = new ConflictDetector(a)
    det.dispose()

    a.insertText(5, " mine")
    a.applyRemoteOps(b.insertText(5, " theirs"))
    expect(det.getConflicts()).toHaveLength(0)
  })
})
