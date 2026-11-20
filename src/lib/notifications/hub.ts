import type { NotificationStreamEvent } from "./events"

/**
 * In-memory pub/sub hub for notification stream events.
 *
 * Server-only. There is no notifications table yet (the feed is client-side
 * mock state — see `src/components/app/notifications-provider.tsx`), so the
 * realtime channel is a per-process fan-out keyed by principal. Like
 * `MemoryAuthBackend`, this loses state on restart and does not scale past
 * one process; it exists so the realtime path is exercisable end-to-end and
 * gives the future Prisma implementation a single seam to plug into
 * (`publishNotificationEvent` is what a backend producer will call).
 *
 * The channel map lives on `globalThis` so hot reloads in development do not
 * orphan subscribers (same pattern as `src/lib/db.ts`).
 */

type Listener = (event: NotificationStreamEvent) => void

const globalForNotifications = globalThis as unknown as {
  __spindleNotificationChannels?: Map<string, Set<Listener>>
}

const channels =
  globalForNotifications.__spindleNotificationChannels ?? new Map<string, Set<Listener>>()

globalForNotifications.__spindleNotificationChannels = channels

/**
 * Register `listener` for events published to `principal`. Returns an
 * unsubscribe function; safe to call more than once.
 */
export function subscribeNotificationEvents(principal: string, listener: Listener): () => void {
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
export function publishNotificationEvent(principal: string, event: NotificationStreamEvent): void {
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
export function resetNotificationHubForTests(): void {
  channels.clear()
}
