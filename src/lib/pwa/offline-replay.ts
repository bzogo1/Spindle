import type { CrdtOp } from "@/lib/collab/crdt"
import type { CollabClient } from "@/lib/collab/sync"
import type { OfflineOpQueue } from "@/lib/collab/offline"

/**
 * Glue between the persisted offline op queue (src/lib/collab/offline.ts) and
 * the WebSocket sync engine (src/lib/collab/sync.ts).
 *
 * `flushOfflineOps` drains the queue through `client.sendOps`, preserving
 * causal order — `OfflineOpQueue.flush` stops at the first failure so nothing
 * is skipped. After a successful drain it calls `client.requestSync()` so the
 * server can catch the document up.
 *
 * `attachOfflineReplay` additionally flushes automatically when the browser
 * fires `online` (covers reconnects that don't go through a fresh socket
 * handshake). The collab components already flush on the client's `onOpen`;
 * this is the safety net for queues whose client was already connected when
 * ops were queued, or where `online` fires before the socket finishes opening
 * (`flush` returns 0 safely and the `onOpen` path handles the real send).
 *
 * Usage (collab mount path — e.g. wherever a `CollabClient` + per-document
 * `OfflineOpQueue` are created):
 *
 *   import { attachOfflineReplay } from "@/lib/pwa/offline-replay"
 *
 *   const replay = attachOfflineReplay({ queue: offlineQueue, client })
 *   // later, on unmount:
 *   replay.dispose()
 *
 * `CollaborativeDoc` already flushes `offlineQueue` inside its client
 * `onOpen` handler, so `attachOfflineReplay` is only needed for queues that
 * are NOT owned by a mounted `CollaborativeDoc` (e.g. background/headless
 * documents, or a queue shared across remounts). It is safe to attach
 * alongside `CollaborativeDoc` — `OfflineOpQueue.flush` serialises through a
 * promise chain, so a double flush is a no-op for already-sent ops.
 */

export interface OfflineReplayDeps {
  queue: OfflineOpQueue
  client: CollabClient
}

/** Flush queued ops through the sync client. Returns ops successfully sent. */
export async function flushOfflineOps({ queue, client }: OfflineReplayDeps): Promise<number> {
  const sent = await queue.flush(async (op: CrdtOp) => {
    if (!client.connected) return false
    client.sendOps([op])
    return true
  })
  // Ask the server to re-handshake so it can send us anything we missed while
  // the queued ops were in flight.
  if (sent > 0 && client.connected) client.requestSync()
  return sent
}

export interface OfflineReplayAttachment {
  /** Manually trigger a flush (e.g. from a reconnect button). */
  flush: () => Promise<number>
  /** Detach the `online` listener. */
  dispose: () => void
}

/**
 * Attach automatic offline-queue replay to `window` `online` events.
 * Returns a handle with `flush`/`dispose`; safe to call in SSR/tests where
 * `window` is absent (the listener simply never attaches).
 */
export function attachOfflineReplay(
  deps: OfflineReplayDeps,
  target: Pick<Window, "addEventListener" | "removeEventListener"> | null = typeof window !==
  "undefined"
    ? window
    : null,
): OfflineReplayAttachment {
  const flush = () => flushOfflineOps(deps)

  const onOnline = () => {
    void flush().catch(() => {
      // flush() already persists progress; a rejection here is storage-level.
    })
  }

  target?.addEventListener("online", onOnline)

  return {
    flush,
    dispose() {
      target?.removeEventListener("online", onOnline)
    },
  }
}
