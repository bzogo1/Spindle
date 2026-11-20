import { describe, expect, it, vi } from "vitest"

import { createOnlineStatusStore, isOnline } from "./offline-status"

describe("createOnlineStatusStore", () => {
  it("reports the navigator.onLine snapshot", () => {
    const store = createOnlineStatusStore()
    expect(store.getSnapshot()).toBe(isOnline())
  })

  it("notifies subscribers on online/offline events", () => {
    const store = createOnlineStatusStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    // subscribe emits the current state immediately.
    expect(listener).toHaveBeenCalledWith(isOnline())

    window.dispatchEvent(new Event("offline"))
    expect(listener).toHaveBeenLastCalledWith(false)
    expect(store.getSnapshot()).toBe(false)

    window.dispatchEvent(new Event("online"))
    expect(listener).toHaveBeenLastCalledWith(true)
    expect(store.getSnapshot()).toBe(true)

    unsubscribe()
  })

  it("stops listening after the last subscriber unsubscribes", () => {
    const store = createOnlineStatusStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()

    listener.mockClear()
    window.dispatchEvent(new Event("offline"))
    expect(listener).not.toHaveBeenCalled()
  })

  it("isolates independent store instances", () => {
    const a = createOnlineStatusStore()
    const b = createOnlineStatusStore()
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const unsubA = a.subscribe(listenerA)
    const unsubB = b.subscribe(listenerB)

    window.dispatchEvent(new Event("offline"))
    expect(listenerA).toHaveBeenCalled()
    expect(listenerB).toHaveBeenCalled()

    unsubA()
    unsubB()
  })
})
