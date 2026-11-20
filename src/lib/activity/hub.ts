import type { ActivityStreamEvent } from "./events"

/**
 * In-memory pub/sub hub for project-activity stream events.
 *
 * Server-only. Mirrors `src/lib/notifications/hub.ts`: there is no activity
 * table yet (feeds are assembled from fixtures/mock state — see
 * `src/lib/api/adapters/mock.ts`), so the realtime channel is a per-process
 * fan-out keyed by principal. Like `MemoryAuthBackend`, this loses state on
 * restart and does not scale past one process; it exists so the realtime
 * path is exercisable end-to-end and gives the future Prisma implementation
 * a single seam to plug into (`publishActivityEvent` is what a backend
 * producer will call).
 *
 * The channel map lives on `globalThis` so hot reloads in development do not
 * orphan subscribers (same pattern as `src/lib/db.ts`).
 */

type Listener = (event: ActivityStreamEvent) => void

const globalForActivity = globalThis as unknown as {
  __spindleActivityChannels?: Map<string, Set<Listener>>
}

const channels = globalForActivity.__spindleActivityChannels ?? new Map<string, Set<Listener>>()

globalForActivity.__spindleActivityChannels = channels

/**
 * Register `listener` for events published to `principal`. Returns an
 * unsubscribe function; safe to call more than once.
 */
export function subscribeActivityEvents(principal: string, listener: Listener): () => void {
  let listeners = channels.get(principal)
  if (!listeners) {
    listeners = new Set()
    channels.set(principal, listeners)
  }
  listeners.add(listener)

  let active = true
  return () => {
    if (!active) return
    active = false
    const current = channels.get(principal)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) channels.delete(principal)
  }
}

/**
 * Fan `event` out to every subscriber of `principal`. Listeners that throw
 * are isolated so one bad consumer cannot break the rest of the fan-out.
 */
export function publishActivityEvent(principal: string, event: ActivityStreamEvent): void {
  const listeners = channels.get(principal)
  if (!listeners || listeners.size === 0) return
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // A failing subscriber must not affect the others or the publisher.
    }
  }
}

/** Test hook: drops every channel and subscriber. */
export function resetActivityHubForTests(): void {
  channels.clear()
}
