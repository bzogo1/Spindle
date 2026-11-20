import { afterEach, describe, expect, it, vi } from "vitest"
import { CollabClient, WebSocketTransport } from "./sync"

/**
 * Minimal fake WebSocket — enough surface for WebSocketTransport
 * (constructor url/protocols, readyState, send/close, onopen/onmessage/
 * onclose/onerror handlers, static OPEN constant). No real network.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly protocols: string | string[] | undefined
  readyState: number = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  closeCalls = 0

  onopen: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls += 1
    this.readyState = FakeWebSocket.CLOSED
  }

  // --- test helpers -----------------------------------------------------
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  fireMessage(data: unknown) {
    this.onmessage?.({ data })
  }

  fireClose(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  fireError() {
    this.onerror?.()
  }
}

const lastSocket = () => FakeWebSocket.instances.at(-1)!

afterEach(() => {
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

function stubWebSocket() {
  FakeWebSocket.instances = []
  vi.stubGlobal("WebSocket", FakeWebSocket)
}

describe("WebSocketTransport", () => {
  it("constructs a WebSocket with the url and protocols", () => {
    stubWebSocket()
    new WebSocketTransport("wss://collab.example.com/doc-1", ["v1", "v2"])
    const ws = lastSocket()
    expect(ws.url).toBe("wss://collab.example.com/doc-1")
    expect(ws.protocols).toEqual(["v1", "v2"])
  })

  it("supports a single protocol string", () => {
    stubWebSocket()
    new WebSocketTransport("ws://x", "v1")
    expect(lastSocket().protocols).toBe("v1")
  })

  it("invokes onOpen callbacks when the socket opens", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const a = vi.fn()
    const b = vi.fn()
    t.onOpen(a)
    t.onOpen(b)
    lastSocket().fireOpen()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("forwards string messages to onMessage callbacks", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const cb = vi.fn()
    t.onMessage(cb)
    lastSocket().fireMessage('{"type":"ops","ops":[]}')
    expect(cb).toHaveBeenCalledWith('{"type":"ops","ops":[]}')
  })

  it("stringifies non-string message data", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const cb = vi.fn()
    t.onMessage(cb)
    lastSocket().fireMessage(42)
    expect(cb).toHaveBeenCalledWith("42")
  })

  it("invokes onClose callbacks with code and reason", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const cb = vi.fn()
    t.onClose(cb)
    lastSocket().fireClose(1006, "abnormal")
    expect(cb).toHaveBeenCalledWith(1006, "abnormal")
  })

  it("send() forwards to the socket only while OPEN", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const ws = lastSocket()

    // CONNECTING → dropped silently.
    t.send("early")
    expect(ws.sent).toHaveLength(0)

    ws.fireOpen()
    t.send("hello")
    expect(ws.sent).toEqual(["hello"])

    // CLOSED → dropped silently.
    ws.fireClose()
    t.send("late")
    expect(ws.sent).toEqual(["hello"])
  })

  it("close() delegates to the underlying socket", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const ws = lastSocket()
    t.close()
    expect(ws.closeCalls).toBe(1)
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it("onerror is a no-op; the following onclose still fires close callbacks", () => {
    stubWebSocket()
    const t = new WebSocketTransport("ws://x")
    const onClose = vi.fn()
    const onMessage = vi.fn()
    t.onClose(onClose)
    t.onMessage(onMessage)

    const ws = lastSocket()
    ws.fireError()
    expect(onClose).not.toHaveBeenCalled()
    expect(onMessage).not.toHaveBeenCalled()

    // Real sockets always follow an error with a close event.
    ws.fireClose(1006, "")
    expect(onClose).toHaveBeenCalledWith(1006, "")
  })
})

describe("CollabClient over WebSocketTransport", () => {
  it("sends the sync-hello handshake once the socket opens", () => {
    stubWebSocket()
    const client = new CollabClient(
      "me",
      "wss://x/doc",
      () => new WebSocketTransport("wss://x/doc"),
    )
    client.getStateVector = () => ({ me: 5 })
    client.connect()

    const ws = lastSocket()
    expect(ws.sent).toHaveLength(0) // nothing before open
    ws.fireOpen()
    const frames = ws.sent.map((m) => JSON.parse(m) as { type: string })
    expect(frames[0]).toMatchObject({
      type: "sync-hello",
      clientId: "me",
      stateVector: { me: 5 },
    })
    client.close()
  })

  it("routes inbound frames and outbound ops through the real transport", () => {
    stubWebSocket()
    const client = new CollabClient(
      "me",
      "wss://x/doc",
      () => new WebSocketTransport("wss://x/doc"),
    )
    const onOps = vi.fn()
    client.setHandlers({ onOps })
    client.connect()
    const ws = lastSocket()
    ws.fireOpen()

    ws.fireMessage(JSON.stringify({ type: "ops", ops: [{ type: "delete", ids: [] }] }))
    expect(onOps).toHaveBeenCalledWith([{ type: "delete", ids: [] }])

    ws.sent.length = 0
    client.sendOps([
      { type: "insert", id: { client: "me", clock: 0 }, leftOrigin: null, text: "hi" },
    ])
    expect(JSON.parse(ws.sent[0])).toMatchObject({ type: "ops" })
    client.close()
  })

  it("reconnects by constructing a new WebSocket after a drop", async () => {
    stubWebSocket()
    const sleeps: number[] = []
    const client = new CollabClient(
      "me",
      "wss://x/doc",
      () => new WebSocketTransport("wss://x/doc"),
      {},
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0 },
    )
    client.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
    lastSocket().fireOpen()

    // Socket drops → client schedules a reconnect → new WebSocket instance.
    lastSocket().fireClose(1006, "lost")
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    expect(sleeps).toHaveLength(1)

    // The replacement socket works end-to-end.
    const ws2 = lastSocket()
    ws2.fireOpen()
    expect(JSON.parse(ws2.sent[0])).toMatchObject({ type: "sync-hello", clientId: "me" })
    client.close()
  })

  it("an error event followed by close still triggers reconnect", async () => {
    stubWebSocket()
    const client = new CollabClient(
      "me",
      "wss://x/doc",
      () => new WebSocketTransport("wss://x/doc"),
      {},
      { sleep: async () => {}, random: () => 0 },
    )
    client.connect()
    const ws = lastSocket()
    ws.fireError()
    ws.fireClose(1006, "")
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    client.close()
  })

  it("close() shuts the socket down and prevents reconnect", async () => {
    stubWebSocket()
    const client = new CollabClient(
      "me",
      "wss://x/doc",
      () => new WebSocketTransport("wss://x/doc"),
      {},
      { sleep: async () => {}, random: () => 0 },
    )
    client.connect()
    const ws = lastSocket()
    ws.fireOpen()
    client.close()
    expect(ws.closeCalls).toBe(1)

    // The close event arriving after client.close() must not reconnect.
    ws.fireClose(1000, "client close")
    await new Promise((r) => setTimeout(r, 10))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
