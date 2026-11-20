import { describe, expect, it, vi } from "vitest"

import type { CrdtOp } from "@/lib/collab/crdt"
import type { CollabClient } from "@/lib/collab/sync"
import { OfflineOpQueue, memoryStorage } from "@/lib/collab/offline"

import { attachOfflineReplay, flushOfflineOps } from "./offline-replay"

const op = (clock: number, text: string): CrdtOp => ({
  type: "insert",
  id: { client: "c1", clock },
  leftOrigin: null,
  text,
})

function fakeClient(connected = true) {
  const sent: CrdtOp[] = []
  const syncRequests: number[] = []
  const client = {
    connected,
    sendOps: vi.fn((ops: CrdtOp[]) => sent.push(...ops)),
    requestSync: vi.fn(() => syncRequests.push(1)),
  }
  return { client: client as unknown as CollabClient, sent, syncRequests }
}

describe("flushOfflineOps", () => {
  it("sends queued ops in order and requests a resync", async () => {
    const { client, sent, syncRequests } = fakeClient()
    const queue = new OfflineOpQueue(`replay-${Math.random()}`, memoryStorage)
    await queue.push(op(0, "a"), op(1, "b"))

    const n = await flushOfflineOps({ queue, client })

    expect(n).toBe(2)
    expect(sent.map((o) => (o.type === "insert" ? o.text : ""))).toEqual(["a", "b"])
    expect(syncRequests).toHaveLength(1)
    expect(await queue.pending()).toHaveLength(0)
  })

  it("keeps ops queued while the client is disconnected", async () => {
    const { client, sent } = fakeClient(false)
    const queue = new OfflineOpQueue(`replay-offline-${Math.random()}`, memoryStorage)
    await queue.push(op(0, "a"))

    const n = await flushOfflineOps({ queue, client })

    expect(n).toBe(0)
    expect(sent).toHaveLength(0)
    expect(await queue.pending()).toHaveLength(1)
  })

  it("does not requestSync when nothing was sent", async () => {
    const { client, syncRequests } = fakeClient()
    const queue = new OfflineOpQueue(`replay-empty-${Math.random()}`, memoryStorage)

    await flushOfflineOps({ queue, client })

    expect(syncRequests).toHaveLength(0)
  })
})

describe("attachOfflineReplay", () => {
  it("flushes the queue when the target fires `online`", async () => {
    const target = new EventTarget()
    const { client, sent } = fakeClient()
    const queue = new OfflineOpQueue(`replay-online-${Math.random()}`, memoryStorage)
    await queue.push(op(0, "x"))

    const attachment = attachOfflineReplay({ queue, client }, target as unknown as Window)
    target.dispatchEvent(new Event("online"))

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(await queue.pending()).toHaveLength(0)
    attachment.dispose()
  })

  it("dispose removes the listener so later `online` events do nothing", async () => {
    const target = new EventTarget()
    const { client, sent } = fakeClient()
    const queue = new OfflineOpQueue(`replay-dispose-${Math.random()}`, memoryStorage)
    await queue.push(op(0, "x"))

    const attachment = attachOfflineReplay({ queue, client }, target as unknown as Window)
    attachment.dispose()
    target.dispatchEvent(new Event("online"))

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toHaveLength(0)
    expect(await queue.pending()).toHaveLength(1)
  })
})
