/**
 * Browser online/offline status tracker.
 *
 * Wraps `navigator.onLine` plus the `online`/`offline` window events in a tiny
 * external-store so React components can subscribe via `useSyncExternalStore`
 * (see src/components/pwa/offline-status.tsx) and plain code can subscribe
 * imperatively. SSR/test safe: without `window`/`navigator` it reports online.
 */

export type OnlineStatusListener = (online: boolean) => void

export interface OnlineStatusStore {
  /** Current snapshot — cheap, safe to call during render. */
  getSnapshot(): boolean
  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: OnlineStatusListener): () => void
}

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true
  return navigator.onLine !== false
}

/**
 * Create an independent online-status store. Each call wires its own window
 * listeners, so tests can build isolated instances; the default exported
 * `onlineStatus` is the shared singleton for the app.
 */
export function createOnlineStatusStore(): OnlineStatusStore {
  const listeners = new Set<OnlineStatusListener>()
  let online = readOnline()
  let listening = false

  const notify = (next: boolean) => {
    if (next === online) return
    online = next
    listeners.forEach((listener) => listener(online))
  }

  const onOnline = () => notify(true)
  const onOffline = () => notify(false)

  const start = () => {
    if (listening || typeof window === "undefined") return
    listening = true
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
  }

  const stop = () => {
    if (!listening || typeof window === "undefined") return
    listening = false
    window.removeEventListener("online", onOnline)
    window.removeEventListener("offline", onOffline)
  }

  return {
    getSnapshot() {
      // Internal state is authoritative: `navigator.onLine` seeds it at
      // creation and the online/offline events keep it current. (Re-reading
      // navigator.onLine here would also be wrong in environments — like
      // jsdom — where it never changes.)
      return online
    },
    subscribe(listener) {
      listeners.add(listener)
      start()
      // Emit the current state so subscribers can initialise synchronously.
      // NOTE: do not resync from navigator.onLine here — React resubscribes
      // whenever the subscribe callback identity changes, and clobbering the
      // event-driven state would flip the snapshot back in environments where
      // navigator.onLine doesn't track the events (e.g. jsdom).
      listener(online)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
  }
}

/** Shared app-wide online status store. */
export const onlineStatus: OnlineStatusStore = createOnlineStatusStore()

/** True when the browser reports connectivity (always true without navigator). */
export function isOnline(): boolean {
  return readOnline()
}
