import type { CrdtOp, StateVector } from "./crdt"
import type { AwarenessState } from "./awareness"

/**
 * WebSocket collaboration client with pluggable transport.
 *
 * Wire protocol (JSON text frames):
 *   → { type: "sync-hello", clientId, stateVector }   handshake + catch-up request
 *   ← { type: "sync-ops", ops: CrdtOp[] }             missing ops from server
 *   → { type: "ops", ops: CrdtOp[] }                  local ops broadcast
 *   ← { type: "ops", ops: CrdtOp[] }                  remote ops broadcast
 *   →/← { type: "awareness", clientId, state|null }   ephemeral presence
 *
 * The transport is injected so tests and demos can run against a mock socket
 * while production uses `WebSocketTransport`.
 */

export interface Transport {
  send(data: string): void
  close(): void
  onOpen(cb: () => void): void
  onMessage(cb: (data: string) => void): void
  onClose(cb: (code?: number, reason?: string) => void): void
}

export type TransportFactory = () => Transport

export type SyncMessage =
  | { type: "sync-hello"; clientId: string; stateVector: StateVector }
  | { type: "sync-ops"; ops: CrdtOp[] }
  | { type: "ops"; ops: CrdtOp[] }
  | { type: "awareness"; clientId: string; state: AwarenessState | null }

export interface CollabClientHandlers {
  /** Remote document ops (already filtered — never includes own echoes unless server echoes). */
  onOps?: (ops: CrdtOp[]) => void
  /** Remote awareness update; state null = peer left. */
  onAwareness?: (clientId: string, state: AwarenessState | null) => void
  onOpen?: () => void
  onClose?: (code?: number, reason?: string) => void
  /** All reconnect attempts exhausted (after maxAttempts). */
  onGiveUp?: () => void
}

export interface ReconnectOptions {
  /** First retry delay in ms. Default 500. */
  baseDelay?: number
  /** Cap on retry delay in ms. Default 30_000. */
  maxDelay?: number
  /** Max consecutive failures before giving up. Default Infinity. */
  maxAttempts?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable for tests; must return [0,1). Default Math.random. */
  random?: () => number
}

/** Exponential backoff with "full jitter" (AWS-style). */
export function computeBackoff(
  attempt: number,
  opts: { baseDelay: number; maxDelay: number; random: () => number },
): number {
  const exp = Math.min(opts.maxDelay, opts.baseDelay * 2 ** attempt)
  return Math.floor(exp * (0.5 + opts.random() * 0.5))
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class CollabClient {
  private transport: Transport | null = null
  private closed = false
  private reconnectAttempt = 0
  private reconnecting = false
  private handlers: CollabClientHandlers
  private readonly opts: Required<Omit<ReconnectOptions, "maxAttempts">> & {
    maxAttempts: number
  }

  constructor(
    private readonly clientId: string,
    private readonly url: string,
    private readonly transportFactory: TransportFactory,
    handlers: CollabClientHandlers = {},
    reconnect: ReconnectOptions = {},
  ) {
    this.handlers = handlers
    this.opts = {
      baseDelay: reconnect.baseDelay ?? 500,
      maxDelay: reconnect.maxDelay ?? 30_000,
      maxAttempts: reconnect.maxAttempts ?? Number.POSITIVE_INFINITY,
      sleep: reconnect.sleep ?? defaultSleep,
      random: reconnect.random ?? Math.random,
    }
  }

  get connected(): boolean {
    return this.transport !== null
  }

  setHandlers(handlers: CollabClientHandlers) {
    this.handlers = handlers
  }

  connect() {
    if (this.closed || this.transport) return
    const t = this.transportFactory()
    this.transport = t

    t.onOpen(() => {
      this.reconnectAttempt = 0
      this.handlers.onOpen?.()
      // Handshake: advertise our state vector so the server can catch us up.
      this.sendRaw({
        type: "sync-hello",
        clientId: this.clientId,
        stateVector: this.getStateVector(),
      })
    })

    t.onMessage((data) => this.handleMessage(data))

    t.onClose((code, reason) => {
      this.transport = null
      this.handlers.onClose?.(code, reason)
      if (!this.closed) this.scheduleReconnect()
    })
  }

  /** State vector provider — wire to `doc.getStateVector`. */
  getStateVector: () => StateVector = () => ({})

  private async scheduleReconnect() {
    if (this.closed || this.reconnecting) return
    if (this.reconnectAttempt >= this.opts.maxAttempts) {
      this.handlers.onGiveUp?.()
      return
    }
    const delay = computeBackoff(this.reconnectAttempt, this.opts)
    this.reconnectAttempt++
    this.reconnecting = true
    await this.opts.sleep(delay)
    this.reconnecting = false
    if (!this.closed) this.connect()
  }

  private handleMessage(data: string) {
    let msg: SyncMessage
    try {
      msg = JSON.parse(data) as SyncMessage
    } catch {
      return
    }
    switch (msg.type) {
      case "sync-ops":
      case "ops":
        if (msg.ops?.length) this.handlers.onOps?.(msg.ops)
        break
      case "awareness":
        this.handlers.onAwareness?.(msg.clientId, msg.state)
        break
    }
  }

  private sendRaw(msg: SyncMessage) {
    if (this.transport) this.transport.send(JSON.stringify(msg))
  }

  /** Broadcast local document ops. No-op while disconnected. */
  sendOps(ops: CrdtOp[]) {
    if (!ops.length || !this.transport) return
    this.sendRaw({ type: "ops", ops })
  }

  /** Send an ephemeral awareness update (state null = leaving). */
  sendAwareness(state: AwarenessState | null) {
    if (!this.transport) return
    this.sendRaw({ type: "awareness", clientId: this.clientId, state })
  }

  /** Force a resync handshake (e.g. after applying queued offline ops). */
  requestSync() {
    if (!this.transport) return
    this.sendRaw({
      type: "sync-hello",
      clientId: this.clientId,
      stateVector: this.getStateVector(),
    })
  }

  close() {
    this.closed = true
    this.transport?.close()
    this.transport = null
  }
}

/** Transport backed by a real WebSocket. */
export class WebSocketTransport implements Transport {
  private ws: WebSocket
  private openCbs: (() => void)[] = []
  private msgCbs: ((data: string) => void)[] = []
  private closeCbs: ((code?: number, reason?: string) => void)[] = []

  constructor(url: string, protocols?: string | string[]) {
    this.ws = new WebSocket(url, protocols)
    this.ws.onopen = () => this.openCbs.forEach((cb) => cb())
    this.ws.onmessage = (ev) => {
      const data = typeof ev.data === "string" ? ev.data : String(ev.data)
      this.msgCbs.forEach((cb) => cb(data))
    }
    this.ws.onclose = (ev) => this.closeCbs.forEach((cb) => cb(ev.code, ev.reason))
    this.ws.onerror = () => {
      // onclose follows; nothing to do here.
    }
  }

  send(data: string) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data)
  }

  close() {
    this.ws.close()
  }

  onOpen(cb: () => void) {
    this.openCbs.push(cb)
  }
  onMessage(cb: (data: string) => void) {
    this.msgCbs.push(cb)
  }
  onClose(cb: (code?: number, reason?: string) => void) {
    this.closeCbs.push(cb)
  }
}
