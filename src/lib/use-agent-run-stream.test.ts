import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { humanizeStreamError, useAgentRunStream } from "./use-agent-run-stream"

/* ------------------------------------------------------------------------ */
/* Transport mocks                                                           */
/* ------------------------------------------------------------------------ */

type Listener = (event: { data: string }) => void

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  closed = false
  onerror: (() => void) | null = null
  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: Listener) {
    let set = this.listeners.get(name)
    if (!set) {
      set = new Set()
      this.listeners.set(name, set)
    }
    set.add(listener)
  }

  removeEventListener(name: string, listener: Listener) {
    this.listeners.get(name)?.delete(listener)
  }

  emit(name: string, data: string) {
    for (const listener of this.listeners.get(name) ?? []) listener({ data })
  }

  close() {
    this.closed = true
  }

  fail() {
    this.onerror?.()
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly url: string
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  closeCalls: number[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()

  close(code = 1000) {
    this.closeCalls.push(code)
    this.onclose?.({ code })
  }

  message(payload: unknown) {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) })
  }

  fail(code = 1006) {
    this.onclose?.({ code })
  }
}

const originalEventSource = globalThis.EventSource
const originalWebSocket = globalThis.WebSocket

function installEventSource() {
  MockEventSource.instances = []
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource
}

function installWebSocket() {
  MockWebSocket.instances = []
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
}

function uninstallEventSource() {
  if (originalEventSource === undefined) {
    // @ts-expect-error jsdom does not provide EventSource
    delete globalThis.EventSource
  } else {
    globalThis.EventSource = originalEventSource
  }
}

function uninstallWebSocket() {
  globalThis.WebSocket = originalWebSocket
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function json(data: Record<string, unknown>) {
  return JSON.stringify(data)
}

function emitEvent(source: MockEventSource, name: string, data: string | Record<string, unknown>) {
  act(() => {
    source.emit(name, typeof data === "string" ? data : json(data))
  })
}

function mockFetchOk() {
  vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }))
}

function mockFetchError(status = 500, body = "boom") {
  vi.mocked(fetch).mockResolvedValue(new Response(body, { status }))
}

/* ------------------------------------------------------------------------ */
/* Tests                                                                     */
/* ------------------------------------------------------------------------ */

describe("useAgentRunStream", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installEventSource()
    installWebSocket()
    mockFetchOk()
  })

  afterEach(() => {
    vi.useRealTimers()
    uninstallEventSource()
    uninstallWebSocket()
  })

  it("opens an EventSource on mount and stays connecting until the first event", () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain("/api/agent/runs/run-1/stream")
    expect(result.current.status).toBe("connecting")
    expect(result.current.entries).toEqual([])
  })

  it("folds SSE events into entries and marks the stream live", () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "log", { id: "e1", message: "hello", source: "agent" })

    expect(result.current.status).toBe("live")
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]).toMatchObject({
      id: "e1",
      kind: "log",
      message: "hello",
      source: "agent",
    })
    expect(result.current.lastEventAt).not.toBeNull()
    expect(result.current.error).toBeNull()
  })

  it("treats a plain `message` SSE event as a log entry", () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "message", "plain text line")

    expect(result.current.status).toBe("live")
    expect(result.current.entries[0]).toMatchObject({ kind: "log", message: "plain text line" })
  })

  it("sets status done and closes the transport on a done event", () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "done", { id: "d1", type: "done", message: "finished" })

    expect(result.current.status).toBe("done")
    expect(result.current.entries[0]).toMatchObject({ kind: "done" })
    expect(source.closed).toBe(true)

    // A late transport error after done must not schedule a reconnect.
    act(() => source.fail())
    act(() => vi.advanceTimersByTime(60_000))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(result.current.status).toBe("done")
  })

  it("falls back to WebSocket when SSE fails before the first event", () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    act(() => source.fail())

    expect(MockWebSocket.instances).toHaveLength(1)
    const ws = MockWebSocket.instances[0]
    expect(ws.url).toContain("ws://")
    expect(ws.url).toContain("/api/agent/runs/run-1/stream")

    act(() => ws.message({ type: "log", id: "w1", message: "via ws" }))
    expect(result.current.status).toBe("live")
    expect(result.current.entries[0]).toMatchObject({ id: "w1", message: "via ws" })
  })

  it("marks the stream unavailable when neither transport exists", () => {
    uninstallEventSource()
    uninstallWebSocket()
    // @ts-expect-error intentional absence
    delete globalThis.EventSource
    // @ts-expect-error intentional absence
    delete globalThis.WebSocket

    const { result } = renderHook(() => useAgentRunStream("run-1"))

    expect(result.current.status).toBe("unavailable")
    expect(result.current.error).toMatch(/Neither EventSource nor WebSocket/)
  })

  it("reconnects with backoff after the stream drops post-event", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5) // jitter factor = 1.0
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const first = MockEventSource.instances[0]

    emitEvent(first, "log", { id: "e1", message: "hi" })
    expect(result.current.status).toBe("live")

    act(() => first.fail())
    expect(result.current.status).toBe("reconnecting")
    expect(result.current.error).toBe("sse_error")

    // Base delay for attempt 1 is 1000ms ± jitter → exactly 1000 with random=0.5.
    act(() => vi.advanceTimersByTime(999))
    expect(MockEventSource.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(MockEventSource.instances).toHaveLength(2)
    expect(result.current.status).toBe("reconnecting")

    // The delivered event resets the consecutive-failure count, so the next
    // failure is attempt 1 again → base delay 1000ms.
    const second = MockEventSource.instances[1]
    emitEvent(second, "log", { id: "e2", message: "again" })
    act(() => second.fail())
    act(() => vi.advanceTimersByTime(1000))
    expect(MockEventSource.instances).toHaveLength(3)
  })

  it("gives up after the retry cap and reports unavailable", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5) // jitter factor = 1.0
    const { result } = renderHook(() => useAgentRunStream("run-1"))

    // SSE fails before any event → one WebSocket fallback, then pure WS retries.
    act(() => MockEventSource.instances[0].fail())
    expect(MockWebSocket.instances).toHaveLength(1)

    // Attempts 1..5 schedule delays 1s/2s/4s/8s/15s; the 6th failure trips the cap.
    const delays = [1000, 2000, 4000, 8000, 15_000]
    for (const delay of delays) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
      act(() => ws.fail(1006))
      expect(result.current.status).not.toBe("unavailable")
      act(() => vi.advanceTimersByTime(delay))
    }

    const last = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    act(() => last.fail(1006))

    expect(result.current.status).toBe("unavailable")
    expect(result.current.error).toBe("ws_closed_1006")

    // No further transports open, even after a long wait.
    const transportCount = MockEventSource.instances.length + MockWebSocket.instances.length
    act(() => vi.advanceTimersByTime(300_000))
    expect(MockEventSource.instances.length + MockWebSocket.instances.length).toBe(transportCount)
  })

  it("keeps retrying past the cap once events flow again", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    const { result } = renderHook(() => useAgentRunStream("run-1"))

    // Fail twice post-event (attempts 1 and 2), then deliver an event on the
    // third transport — the counter resets, so later failures start over.
    const first = MockEventSource.instances[0]
    emitEvent(first, "log", { id: "e1", message: "hi" })
    act(() => first.fail())
    act(() => vi.advanceTimersByTime(1000))
    const second = MockEventSource.instances[1]
    act(() => second.fail())
    act(() => vi.advanceTimersByTime(2000))
    const third = MockEventSource.instances[2]
    emitEvent(third, "log", { id: "e2", message: "back" })
    act(() => third.fail())
    // Attempt counter restarted → first backoff delay again.
    act(() => vi.advanceTimersByTime(1000))
    expect(MockEventSource.instances).toHaveLength(4)
    expect(result.current.status).toBe("reconnecting")
  })

  it("does not reconnect when the retry timer is cleared by unmount", () => {
    const { result, unmount } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "log", { id: "e1", message: "hi" })
    act(() => source.fail())
    expect(result.current.status).toBe("reconnecting")

    unmount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it("cancel() posts to the cancel endpoint and stops the stream", async () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]
    emitEvent(source, "log", { id: "e1", message: "hi" })

    let cancelled = false
    await act(async () => {
      cancelled = await result.current.cancel()
    })

    expect(cancelled).toBe(true)
    expect(result.current.status).toBe("cancelled")
    expect(source.closed).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/runs/run-1/cancel",
      expect.objectContaining({ method: "POST" }),
    )

    // Late failures after cancel must not reconnect.
    act(() => source.fail())
    act(() => vi.advanceTimersByTime(60_000))
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it("cancel() reports failure and keeps streaming when the endpoint errors", async () => {
    mockFetchError(500, JSON.stringify({ error: "run already finished" }))
    const { result } = renderHook(() => useAgentRunStream("run-1"))

    let cancelled = false
    await act(async () => {
      cancelled = await result.current.cancel()
    })

    expect(cancelled).toBe(false)
    expect(result.current.status).toBe("connecting")
    expect(result.current.error).toBe("run already finished")
  })

  it("resolveApproval posts the decision and patches the matching entry", async () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "approval", {
      id: "ap-entry",
      type: "approval",
      approvalId: "ap-1",
      action: "delete_file",
      summary: "Delete tmp.txt",
    })
    expect(result.current.entries[0]).toMatchObject({ kind: "approval_required" })

    let ok = false
    await act(async () => {
      ok = await result.current.resolveApproval("ap-1", "approved")
    })

    expect(ok).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/runs/run-1/approvals/ap-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ decision: "approved" }),
      }),
    )
    expect(result.current.entries[0].data).toMatchObject({ status: "approved" })
  })

  it("resolveApproval surfaces errors without touching entries", async () => {
    mockFetchError(403, JSON.stringify({ error: "forbidden" }))
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "approval", { id: "ap-entry", approvalId: "ap-1", action: "x" })
    const before = result.current.entries

    let ok = true
    await act(async () => {
      ok = await result.current.resolveApproval("ap-1", "rejected")
    })

    expect(ok).toBe(false)
    expect(result.current.error).toBe("forbidden")
    expect(result.current.entries).toBe(before)
  })

  it("reset() clears entries, closes the transport, and returns to idle", () => {
    const { result } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    emitEvent(source, "log", { id: "e1", message: "hi" })
    act(() => result.current.reset())

    expect(result.current.status).toBe("idle")
    expect(result.current.entries).toEqual([])
    expect(result.current.lastEventAt).toBeNull()
    expect(source.closed).toBe(true)

    // No reconnect is scheduled after reset.
    act(() => vi.advanceTimersByTime(60_000))
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it("holds no connection and reports idle when disabled", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useAgentRunStream("run-1", { enabled }),
      { initialProps: { enabled: false } },
    )

    expect(result.current.status).toBe("idle")
    expect(MockEventSource.instances).toHaveLength(0)
    expect(MockWebSocket.instances).toHaveLength(0)

    rerender({ enabled: true })
    expect(result.current.status).toBe("connecting")
    expect(MockEventSource.instances).toHaveLength(1)

    rerender({ enabled: false })
    expect(result.current.status).toBe("idle")
    expect(result.current.entries).toEqual([])
    expect(MockEventSource.instances[0].closed).toBe(true)
  })

  it("closes the transport on unmount", () => {
    const { unmount } = renderHook(() => useAgentRunStream("run-1"))
    const source = MockEventSource.instances[0]

    unmount()
    expect(source.closed).toBe(true)
  })

  it("does nothing when runId is undefined", () => {
    const { result } = renderHook(() => useAgentRunStream(undefined))

    expect(result.current.status).toBe("idle")
    expect(MockEventSource.instances).toHaveLength(0)
    expect(MockWebSocket.instances).toHaveLength(0)
  })
})

describe("humanizeStreamError", () => {
  it("maps transport failure codes to readable copy", () => {
    expect(humanizeStreamError("sse_error")).toMatch(/unreachable/)
    expect(humanizeStreamError("ws_error")).toMatch(/connection failed/)
    expect(humanizeStreamError("ws_closed")).toMatch(/closed unexpectedly/)
    expect(humanizeStreamError("ws_closed_1006")).toBe(
      "The live event stream disconnected (code 1006).",
    )
  })

  it("passes server-provided messages through and handles empty input", () => {
    expect(humanizeStreamError("run already finished")).toBe("run already finished")
    expect(humanizeStreamError(null)).toBeNull()
    expect(humanizeStreamError(undefined)).toBeNull()
    expect(humanizeStreamError("")).toBeNull()
  })
})
