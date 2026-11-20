import type { Transport } from "./sync"

/**
 * In-memory transport for tests and demos.
 *
 * `MockHub` acts as a trivial server: every message a transport sends is
 * delivered (asynchronously) to every *other* transport in the hub. A hub
 * can also be scripted to drop messages or sever connections to exercise
 * offline/reconnect paths.
 */

type Cb = (data?: unknown) => void

export class MockTransport implements Transport {
  private openCbs: Cb[] = []
  private msgCbs: ((data: string) => void)[] = []
  private closeCbs: Cb[] = []
  private hub: MockHub | null = null
  private opened = false
  /** When true, send() drops messages (simulates offline). */
  dropMessages = false
  /** Messages sent while offline or before open — kept for inspection. */
  readonly sentLog: string[] = []

  constructor(
    private readonly hubRef?: MockHub,
    private readonly opts: { autoOpen?: boolean } = {},
  ) {
    this.hub = hubRef ?? null
    // Connect asynchronously like a real socket.
    if (opts.autoOpen !== false) queueMicrotask(() => this.open())
  }

  private open() {
    if (this.opened) return
    this.opened = true
    this.hub?.attach(this)
    this.openCbs.forEach((cb) => cb())
  }

  /** Test hook: manually trigger the open sequence. */
  simulateOpen() {
    this.open()
  }

  /** Test hook: simulate the socket closing. */
  simulateClose(code = 1006, reason = "") {
    this.hub?.detach(this)
    this.opened = false
    this.closeCbs.forEach((cb) => cb({ code, reason }))
  }

  /** Deliver an inbound message (used by the hub). */
  _receive(data: string) {
    this.msgCbs.forEach((cb) => cb(data))
  }

  send(data: string) {
    this.sentLog.push(data)
    if (this.dropMessages || !this.opened) return
    this.hub?.broadcast(this, data)
  }

  close() {
    this.simulateClose(1000, "client close")
  }

  onOpen(cb: () => void) {
    this.openCbs.push(cb)
  }
  onMessage(cb: (data: string) => void) {
    this.msgCbs.push(cb)
  }
  onClose(cb: (code?: number, reason?: string) => void) {
    this.closeCbs.push((ev) =>
      cb((ev as { code?: number })?.code, (ev as { reason?: string })?.reason),
    )
  }
}

export class MockHub {
  private transports = new Set<MockTransport>()
  /** When true, broadcast drops all messages (server down). */
  down = false
  /** Optional filter: return false to drop a message. */
  filter: ((from: MockTransport, data: string) => boolean) | null = null

  attach(t: MockTransport) {
    this.transports.add(t)
  }

  detach(t: MockTransport) {
    this.transports.delete(t)
  }

  broadcast(from: MockTransport, data: string) {
    if (this.down) return
    if (this.filter && !this.filter(from, data)) return
    // Async delivery like a real network hop.
    queueMicrotask(() => {
      for (const t of this.transports) {
        if (t !== from) t._receive(data)
      }
    })
  }
}

/** Two transports wired through a shared hub — handy for two-client tests. */
export function createMockPair(): { hub: MockHub; a: MockTransport; b: MockTransport } {
  const hub = new MockHub()
  return { hub, a: new MockTransport(hub), b: new MockTransport(hub) }
}
