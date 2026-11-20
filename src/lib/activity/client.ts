import type { ActivityEvent } from "../api/types"
import {
  ACTIVITY_BROADCAST_CHANNEL,
  ACTIVITY_LIVE_EVENT,
  ACTIVITY_PUBLISH_PATH,
  isActivityEvent,
} from "./events"

/**
 * Client-side delivery and merge helpers for live activity events.
 *
 * `pushActivityEvent` is the producer entry point — the activity counterpart
 * of `pushAppNotification`/`notify` in
 * `src/components/app/notifications-provider.tsx`. It fans the event out over
 * three paths so every surface converges:
 *  - same-tab window CustomEvent (`ACTIVITY_LIVE_EVENT`)
 *  - cross-tab BroadcastChannel (`ACTIVITY_BROADCAST_CHANNEL`)
 *  - `POST /api/activity` → in-memory hub → SSE to the caller's other
 *    tabs/devices (and back to this tab, where the stable `id` dedupes it)
 *
 * Everything is guarded so the module is safe to call during SSR and in
 * tests: with no `window`/`fetch` it is a no-op.
 */

/**
 * Push an activity event to every mounted `useActivityEvents` subscriber —
 * the current tab via a window CustomEvent, other same-origin tabs via
 * BroadcastChannel, and other devices via the publish endpoint. No-ops
 * during SSR.
 */
export function pushActivityEvent(event: ActivityEvent) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<ActivityEvent>(ACTIVITY_LIVE_EVENT, { detail: event }))
  try {
    const channel = new BroadcastChannel(ACTIVITY_BROADCAST_CHANNEL)
    channel.postMessage(event)
    channel.close()
  } catch {
    // BroadcastChannel unavailable (older browsers, some test envs) — the
    // same-tab CustomEvent above still delivers.
  }

  // Fire-and-forget publish to POST /api/activity, which fans the event out
  // over SSE to the caller's other tabs/devices. Never throws — the local
  // delivery paths above remain the fallback when the endpoint is
  // unreachable or the session is absent.
  if (typeof fetch === "undefined") return
  try {
    void fetch(ACTIVITY_PUBLISH_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "activity", activity: event }),
    }).catch(() => {})
  } catch {
    // Network/fetch failures are irrelevant — realtime is best-effort.
  }
}

/**
 * Merge the events a query returned (`base`, already newest-first) with
 * events delivered live (`live`). Duplicates are dropped by `id` — the live
 * copy wins so a just-published event is never shadowed by a stale refetch —
 * and the result is sorted newest-first by `createdAt`.
 */
export function mergeActivityEvents(
  base: readonly ActivityEvent[],
  live: readonly ActivityEvent[],
): ActivityEvent[] {
  const seen = new Set<string>()
  const merged: ActivityEvent[] = []
  for (const event of [...live, ...base]) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    merged.push(event)
  }
  return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Convenience re-export so screens can validate incoming payloads without reaching into events.ts. */
export { isActivityEvent }
