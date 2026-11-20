import { describe, expect, it } from "vitest"
import { OfflineOpQueue, localStorageStorage, memoryStorage } from "./offline"
import type { CrdtOp } from "./crdt"

const op = (clock: number, text: string): CrdtOp => ({
  type: "insert",
  id: { client: "c1", clock },
  leftOrigin: null,
  text,
})

describe("OfflineOpQueue", () => {
  it("persists ops and restores them on a new queue instance", async () => {
    const storage = memoryStorage
    const q1 = new OfflineOpQueue("doc-1", storage)
    await q1.push(op(0, "he"), op(2, "llo"))
    expect(await q1.pending()).toHaveLength(2)

    const q2 = new OfflineOpQueue("doc-1", storage)
    const pending = await q2.pending()
    expect(pending).toHaveLength(2)
    expect(pending[0]).toMatchObject({ type: "insert" })
  })

  it("flushes in causal order and removes sent ops", async () => {
    const q = new OfflineOpQueue("doc-2", memoryStorage)
    await q.push(op(0, "a"), op(1, "b"), op(2, "c"))

    const sent: CrdtOp[] = []
    const n = await q.flush(async (o) => {
      sent.push(o)
      return true
    })
    expect(n).toBe(3)
    expect(sent.map((o) => (o.type === "insert" ? o.text : ""))).toEqual(["a", "b", "c"])
    expect(await q.pending()).toHaveLength(0)
  })

  it("stops flushing on first failure and keeps the remainder", async () => {
    const q = new OfflineOpQueue("doc-3", memoryStorage)
    await q.push(op(0, "a"), op(1, "b"), op(2, "c"))

    let calls = 0
    const n = await q.flush(async () => ++calls < 2)
    expect(n).toBe(1)
    const pending = await q.pending()
    expect(pending).toHaveLength(2)
    expect(pending[0]).toMatchObject({ id: { clock: 1 } })
  })

  it("serialises concurrent pushes", async () => {
    const q = new OfflineOpQueue("doc-4", memoryStorage)
    await Promise.all([q.push(op(0, "x")), q.push(op(1, "y"))])
    expect(await q.pending()).toHaveLength(2)
  })

  it("localStorage storage round-trips", async () => {
    const storage = localStorageStorage("test-queue:")
    await storage.save("k", [op(0, "z")])
    expect(await storage.load("k")).toHaveLength(1)
    await storage.clear("k")
    expect(await storage.load("k")).toHaveLength(0)
  })

  it("clear() empties the queue and persisted storage", async () => {
    const storage = memoryStorage
    const q1 = new OfflineOpQueue("doc-clear", storage)
    await q1.push(op(0, "a"), op(1, "b"))
    await q1.clear()
    expect(await q1.pending()).toHaveLength(0)
    expect(q1.size).toBe(0)

    // A fresh instance sees the cleared storage too.
    const q2 = new OfflineOpQueue("doc-clear", storage)
    expect(await q2.pending()).toHaveLength(0)
  })

  it("load() restores ops pushed by another instance and is idempotent", async () => {
    const storage = memoryStorage
    const q1 = new OfflineOpQueue("doc-load", storage)
    await q1.push(op(0, "x"))

    const q2 = new OfflineOpQueue("doc-load", storage)
    const first = await q2.load()
    const second = await q2.load()
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    // load() returns a snapshot — mutating it must not corrupt the queue.
    first.pop()
    expect(await q2.pending()).toHaveLength(1)
  })

  it("size reflects queued ops and shrinks after flush", async () => {
    const q = new OfflineOpQueue("doc-size", memoryStorage)
    await q.push(op(0, "a"), op(1, "b"))
    expect(q.size).toBe(2)
    await q.flush(async () => true)
    expect(q.size).toBe(0)
  })

  it("flush with zero queued ops returns 0 without calling send", async () => {
    const q = new OfflineOpQueue("doc-empty", memoryStorage)
    let calls = 0
    const n = await q.flush(async () => {
      calls++
      return true
    })
    expect(n).toBe(0)
    expect(calls).toBe(0)
  })
})
