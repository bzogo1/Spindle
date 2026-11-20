import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { startOutboxPolling, type ReplayResult } from "./background-sync"

const result = (over: Partial<ReplayResult> = {}): ReplayResult => ({
  sent: 0,
  failed: 0,
  dropped: 0,
  remaining: 0,
  ...over,
})

describe("startOutboxPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("replays immediately on start, on `online` events and on the interval", async () => {
    const replay = vi.fn(async () => result({ sent: 1 }))
    const onResult = vi.fn()
    const target = new EventTarget()

    const stop = startOutboxPolling({
      replay,
      intervalMs: 1000,
      target: target as unknown as Window,
      onResult,
    })

    // Immediate pass on start.
    await vi.advanceTimersByTimeAsync(0)
    expect(replay).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(result({ sent: 1 }))

    // `online` event triggers a replay.
    target.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(0)
    expect(replay).toHaveBeenCalledTimes(2)

    // Interval triggers further replays.
    await vi.advanceTimersByTimeAsync(1000)
    expect(replay).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(replay).toHaveBeenCalledTimes(4)

    stop()
  })

  it("stop() halts interval and online-triggered replays", async () => {
    const replay = vi.fn(async () => result())
    const target = new EventTarget()

    const stop = startOutboxPolling({
      replay,
      intervalMs: 500,
      target: target as unknown as Window,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(replay).toHaveBeenCalledTimes(1)

    stop()
    target.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(2000)

    expect(replay).toHaveBeenCalledTimes(1)
  })

  it("does not overlap in-flight replays", async () => {
    let resolveReplay: (r: ReplayResult) => void = () => {}
    const replay = vi.fn(
      () =>
        new Promise<ReplayResult>((resolve) => {
          resolveReplay = resolve
        }),
    )
    const target = new EventTarget()

    const stop = startOutboxPolling({
      replay,
      intervalMs: 100,
      target: target as unknown as Window,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(replay).toHaveBeenCalledTimes(1)

    // While the first replay is in flight, online + interval must not stack.
    target.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(500)
    expect(replay).toHaveBeenCalledTimes(1)

    resolveReplay(result())
    await vi.advanceTimersByTimeAsync(0)

    stop()
  })

  it("swallows replay errors so polling never crashes", async () => {
    const replay = vi.fn(async () => {
      throw new Error("idb exploded")
    })
    const onResult = vi.fn()

    const stop = startOutboxPolling({ replay, intervalMs: 100, onResult })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)

    expect(replay).toHaveBeenCalledTimes(2)
    expect(onResult).not.toHaveBeenCalled()

    stop()
  })
})
