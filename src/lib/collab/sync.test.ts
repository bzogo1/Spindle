import { describe, expect, it, vi } from "vitest"
import { CollabClient, computeBackoff } from "./sync"
import { MockHub, MockTransport } from "./mock-transport"
import { CollaborativeDocument } from "./document"
import type { CrdtOp } from "./crdt"
import type { AwarenessState } from "./awareness"

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("computeBackoff", () => {
  it("grows exponentially and stays within jitter bounds", () => {
    const opts = { baseDelay: 100, maxDelay: 1000, random: () => 0 }
    // random=0 → delay = exp * 0.5
    expect(computeBackoff(0, opts)).toBe(50)
    expect(computeBackoff(1, opts)).toBe(100)
    expect(computeBackoff(2, opts)).toBe(200)
    expect(computeBackoff(10, opts)).toBe(500) // capped at maxDelay*0.5
  })

  it("respects maxDelay cap", () => {
    const d = computeBackoff(20, { baseDelay: 100, maxDelay: 300, random: () => 0.999 })
    expect(d).toBeLessThanOrEqual(300)
    expect(d).toBeGreaterThan(150)
  })
})

describe("CollabClient", () => {
  it("sends a sync-hello handshake on open", async () => {
    const hub = new MockHub()
    const transport = new MockTransport(hub)
    const client = new CollabClient("me", "ws://x", () => transport, {})
    client.getStateVector = () => ({ me: 3 })
    client.connect()
    await flush()
    const hello = transport.sentLog.map((m) => JSON.parse(m))
    expect(hello[0]).toMatchObject({ type: "sync-hello", clientId: "me", stateVector: { me: 3 } })
    client.close()
  })

  it("routes inbound ops and awareness messages to handlers", async () => {
    const hub = new MockHub()
    const server = new MockTransport(hub)
    const client = new CollabClient("me", "ws://x", () => new MockTransport(hub), {})
    const onOps = vi.fn()
    const onAwareness = vi.fn()
    client.setHandlers({ onOps, onAwareness })
    client.connect()
    await flush()

    server.send(JSON.stringify({ type: "ops", ops: [{ type: "delete", ids: [] }] }))
    server.send(
      JSON.stringify({
        type: "awareness",
        clientId: "peer",
        state: { user: { id: "peer", name: "P", color: "#fff" }, updatedAt: 1 },
      }),
    )
    await flush()
    expect(onOps).toHaveBeenCalled()
    expect(onAwareness).toHaveBeenCalledWith("peer", expect.objectContaining({ updatedAt: 1 }))
    client.close()
  })

  it("reconnects with exponential backoff + jitter", async () => {
    const hub = new MockHub()
    const delays: number[] = []
    const transports: MockTransport[] = []
    const client = new CollabClient(
      "me",
      "ws://x",
      // autoOpen:false → onOpen never fires, so backoff keeps growing.
      () => {
        const t = new MockTransport(hub, { autoOpen: false })
        transports.push(t)
        return t
      },
      {},
      {
        baseDelay: 100,
        maxDelay: 10_000,
        random: () => 0,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    )
    client.connect()
    expect(transports).toHaveLength(1)

    // Three consecutive drops → delays 50, 100, 200 (base*2^n*0.5 jitter).
    for (let i = 0; i < 3; i++) {
      transports.at(-1)!.simulateClose(1006)
      await flush()
      await flush()
    }
    expect(delays).toEqual([50, 100, 200])
    expect(transports.length).toBeGreaterThanOrEqual(4)
    client.close()
  })

  it("resets backoff after a successful reconnect", async () => {
    const hub = new MockHub()
    const delays: number[] = []
    const client = new CollabClient(
      "me",
      "ws://x",
      () => new MockTransport(hub),
      {},
      { baseDelay: 100, random: () => 0, sleep: async (ms) => void delays.push(ms) },
    )
    client.connect()
    await flush()
    const t1 = [...(hub as unknown as { transports: Set<MockTransport> }).transports][0]
    t1.simulateClose()
    await flush()
    await flush()
    // Reconnect opened successfully → attempt counter reset.
    const t2 = [...(hub as unknown as { transports: Set<MockTransport> }).transports].at(-1)!
    t2.simulateClose()
    await flush()
    await flush()
    expect(delays).toEqual([50, 50])
    client.close()
  })

  it("gives up after maxAttempts", async () => {
    const hub = new MockHub()
    const onGiveUp = vi.fn()
    const transports: MockTransport[] = []
    const client = new CollabClient(
      "me",
      "ws://x",
      () => {
        const t = new MockTransport(hub, { autoOpen: false })
        transports.push(t)
        return t
      },
      { onGiveUp },
      { maxAttempts: 1, sleep: async () => {}, random: () => 0 },
    )
    client.connect()
    transports[0].simulateClose()
    await flush()
    await flush()
    expect(transports).toHaveLength(2) // one retry allowed
    transports[1].simulateClose()
    await flush()
    await flush()
    expect(onGiveUp).toHaveBeenCalled()
    client.close()
  })

  it("end-to-end: two clients exchange ops and converge", async () => {
    const hub = new MockHub()
    const mkClient = (id: string) =>
      new CollabClient(id, "ws://x", () => new MockTransport(hub), {})

    const clientA = mkClient("a")
    const clientB = mkClient("b")
    const docA = new CollaborativeDocument("a")
    const docB = new CollaborativeDocument("b")
    docA.getStateVector = docA.getStateVector.bind(docA)

    // Ops authored by docA arrive at clientB → applied to docB (its replica),
    // and vice versa.
    clientA.setHandlers({ onOps: (ops: CrdtOp[]) => docA.applyRemoteOps(ops) })
    clientB.setHandlers({ onOps: (ops: CrdtOp[]) => docB.applyRemoteOps(ops) })
    clientA.getStateVector = () => docA.getStateVector()
    clientB.getStateVector = () => docB.getStateVector()
    clientA.connect()
    clientB.connect()
    await flush()

    // Wait — ops should flow A→B and B→A through the hub.
    // Wire local ops to the wire.
    docA.onLocalOps((ops) => clientA.sendOps(ops))
    docB.onLocalOps((ops) => clientB.sendOps(ops))

    docA.insertText(0, "from-a ")
    docB.insertText(0, "from-b ")
    await flush()
    await flush()

    expect(docA.text).toBe(docB.text)
    expect(docA.text).toContain("from-a")
    expect(docA.text).toContain("from-b")
    clientA.close()
    clientB.close()
  })

  it("awareness messages round-trip between clients", async () => {
    const hub = new MockHub()
    const a = new CollabClient("a", "ws://x", () => new MockTransport(hub), {})
    const b = new CollabClient("b", "ws://x", () => new MockTransport(hub), {})
    const seen: [string, AwarenessState | null][] = []
    b.setHandlers({ onAwareness: (cid, st) => seen.push([cid, st]) })
    a.connect()
    b.connect()
    await flush()
    const st: AwarenessState = {
      user: { id: "a", name: "Alice", color: "#f00" },
      cursor: 4,
      updatedAt: 1,
    }
    a.sendAwareness(st)
    await flush()
    expect(seen).toEqual([["a", st]])
    a.sendAwareness(null)
    await flush()
    expect(seen[1]).toEqual(["a", null])
    a.close()
    b.close()
  })

  it("requestSync re-sends the handshake with the current state vector", async () => {
    const hub = new MockHub()
    const transport = new MockTransport(hub)
    const client = new CollabClient("me", "ws://x", () => transport, {})
    client.getStateVector = () => ({ me: 7, peer: 3 })
    client.connect()
    await flush()
    transport.sentLog.length = 0

    client.requestSync()
    const msgs = transport.sentLog.map((m) => JSON.parse(m))
    expect(msgs).toEqual([{ type: "sync-hello", clientId: "me", stateVector: { me: 7, peer: 3 } }])
    client.close()
  })

  it("ignores malformed and unknown messages without throwing", async () => {
    const hub = new MockHub()
    const server = new MockTransport(hub)
    const client = new CollabClient("me", "ws://x", () => new MockTransport(hub), {})
    const onOps = vi.fn()
    const onAwareness = vi.fn()
    client.setHandlers({ onOps, onAwareness })
    client.connect()
    await flush()

    server.send("not-json{{{")
    server.send(JSON.stringify({ type: "mystery" }))
    server.send(JSON.stringify({ type: "ops", ops: [] })) // empty ops → no callback
    await flush()
    expect(onOps).not.toHaveBeenCalled()
    expect(onAwareness).not.toHaveBeenCalled()
    client.close()
  })

  it("sendOps is a no-op while disconnected or given an empty batch", async () => {
    const hub = new MockHub()
    const transport = new MockTransport(hub)
    const client = new CollabClient("me", "ws://x", () => transport, {})
    client.connect()
    await flush()
    transport.sentLog.length = 0

    client.sendOps([])
    expect(transport.sentLog).toHaveLength(0)

    transport.simulateClose()
    await flush()
    await flush()
    // After close the client schedules a reconnect; close it to stop that.
    client.close()
    client.sendOps([{ type: "delete", ids: [] }])
    // sentLog may contain reconnect hellos; assert no "ops" frame was sent.
    const types = transport.sentLog.map((m) => (JSON.parse(m) as { type: string }).type)
    expect(types).not.toContain("ops")
  })

  it("ops frames sent while connected reach the peer's onOps handler", async () => {
    const hub = new MockHub()
    const a = new CollabClient("a", "ws://x", () => new MockTransport(hub), {})
    const b = new CollabClient("b", "ws://x", () => new MockTransport(hub), {})
    const onOpsB = vi.fn()
    b.setHandlers({ onOps: onOpsB })
    a.connect()
    b.connect()
    await flush()

    const op: CrdtOp = {
      type: "insert",
      id: { client: "a", clock: 0 },
      leftOrigin: null,
      text: "hi",
    }
    a.sendOps([op])
    await flush()
    expect(onOpsB).toHaveBeenCalledWith([op])
    a.close()
    b.close()
  })
})
