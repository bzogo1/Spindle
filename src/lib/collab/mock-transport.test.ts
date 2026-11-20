import { describe, expect, it, vi } from "vitest"
import { createMockPair, MockHub, MockTransport } from "./mock-transport"

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("MockTransport", () => {
  it("delivers messages to other hub members asynchronously", async () => {
    const { a, b } = createMockPair()
    const onA = vi.fn()
    const onB = vi.fn()
    a.onMessage(onA)
    b.onMessage(onB)
    await flush() // let autoOpen run

    a.send("hello")
    // Not delivered synchronously — network hop is a microtask.
    expect(onB).not.toHaveBeenCalled()
    await flush()
    expect(onB).toHaveBeenCalledWith("hello")
    expect(onA).not.toHaveBeenCalled() // sender never receives its own message
  })

  it("delivers in both directions through createMockPair", async () => {
    const { a, b } = createMockPair()
    const seenA: string[] = []
    const seenB: string[] = []
    a.onMessage((d) => seenA.push(d))
    b.onMessage((d) => seenB.push(d))
    await flush()

    a.send("a→b")
    b.send("b→a")
    await flush()
    expect(seenB).toEqual(["a→b"])
    expect(seenA).toEqual(["b→a"])
  })

  it("dropMessages logs but does not deliver", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub)
    const b = new MockTransport(hub)
    const onB = vi.fn()
    b.onMessage(onB)
    await flush()

    a.dropMessages = true
    a.send("lost")
    await flush()
    expect(onB).not.toHaveBeenCalled()
    expect(a.sentLog).toEqual(["lost"])
  })

  it("sends before open are logged but not delivered; delivered after simulateOpen", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub, { autoOpen: false })
    const b = new MockTransport(hub)
    const onB = vi.fn()
    b.onMessage(onB)
    await flush() // b opens; a stays closed

    a.send("early")
    await flush()
    expect(onB).not.toHaveBeenCalled()
    expect(a.sentLog).toEqual(["early"])

    a.simulateOpen()
    a.send("late")
    await flush()
    // Only "late" arrives — "early" was dropped while closed.
    expect(onB).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledWith("late")
  })

  it("simulateOpen is idempotent and does not re-fire open callbacks", async () => {
    const a = new MockTransport(new MockHub(), { autoOpen: false })
    const onOpen = vi.fn()
    a.onOpen(onOpen)
    a.simulateOpen()
    a.simulateOpen()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("simulateClose detaches from the hub and notifies close callbacks", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub)
    const b = new MockTransport(hub)
    const onCloseA = vi.fn()
    const onMessageA = vi.fn()
    a.onClose(onCloseA)
    a.onMessage(onMessageA)
    await flush()

    a.simulateClose(1006, "boom")
    expect(onCloseA).toHaveBeenCalledWith(1006, "boom")

    // a is detached: b's messages no longer reach it.
    b.send("after-close")
    await flush()
    expect(onMessageA).not.toHaveBeenCalled()

    // a's own sends are dropped while closed but still logged.
    a.send("while-closed")
    await flush()
    expect(a.sentLog).toEqual(["while-closed"])
  })

  it("a reopened transport can send again (reconnect path)", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub)
    const b = new MockTransport(hub)
    const onB = vi.fn()
    b.onMessage(onB)
    await flush()

    a.simulateClose()
    a.simulateOpen()
    a.send("reconnected")
    await flush()
    expect(onB).toHaveBeenCalledWith("reconnected")
  })

  it("close() fires close callbacks with code 1000", () => {
    const a = new MockTransport(new MockHub(), { autoOpen: false })
    const onClose = vi.fn()
    a.onClose(onClose)
    a.close()
    expect(onClose).toHaveBeenCalledWith(1000, "client close")
  })

  it("_receive invokes all registered message callbacks", () => {
    const a = new MockTransport(new MockHub(), { autoOpen: false })
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    a.onMessage(cb1)
    a.onMessage(cb2)
    a._receive("raw")
    expect(cb1).toHaveBeenCalledWith("raw")
    expect(cb2).toHaveBeenCalledWith("raw")
  })
})

describe("MockHub", () => {
  it("down=true drops all broadcasts", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub)
    const b = new MockTransport(hub)
    const onB = vi.fn()
    b.onMessage(onB)
    await flush()

    hub.down = true
    a.send("lost")
    await flush()
    expect(onB).not.toHaveBeenCalled()

    hub.down = false
    a.send("back")
    await flush()
    expect(onB).toHaveBeenCalledWith("back")
  })

  it("filter can drop selected messages and sees sender + payload", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub)
    const b = new MockTransport(hub)
    const seen: string[] = []
    const onB = vi.fn((d: string) => seen.push(d))
    b.onMessage(onB)
    await flush()

    hub.filter = (from, data) => {
      expect(from).toBe(a)
      return !data.includes("drop")
    }
    a.send("drop-me")
    a.send("keep-me")
    await flush()
    expect(seen).toEqual(["keep-me"])
  })

  it("does not deliver to a transport that joined after broadcast", async () => {
    const hub = new MockHub()
    const a = new MockTransport(hub)
    await flush()
    a.send("before-c")
    await flush()

    const c = new MockTransport(hub)
    const onC = vi.fn()
    c.onMessage(onC)
    await flush()
    // The earlier broadcast already fired; c only sees later messages.
    expect(onC).not.toHaveBeenCalled()
    a.send("after-c")
    await flush()
    expect(onC).toHaveBeenCalledWith("after-c")
  })
})
