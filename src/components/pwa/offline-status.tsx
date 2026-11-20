"use client"

import { useSyncExternalStore } from "react"

import { onlineStatus } from "@/lib/pwa/offline-status"

/**
 * Graceful-degradation banner for connectivity loss.
 *
 * Renders nothing while online. When the browser reports offline it shows a
 * small fixed banner telling the user edits are queued locally and will sync
 * on reconnect — the collab offline queue (src/lib/collab/offline.ts) plus
 * background sync (src/lib/pwa/background-sync.ts) make that true.
 *
 * Mounted once in a root layout alongside <ServiceWorkerRegistration />.
 */
/** Stable subscribe/getSnapshot pair for `useSyncExternalStore`. */
const subscribeOnline = (listener: () => void) => onlineStatus.subscribe(listener)
const getOnlineSnapshot = () => onlineStatus.getSnapshot()
const getServerSnapshot = () => true

export function OfflineIndicator() {
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot)

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-border bg-card text-card-foreground fixed top-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg"
    >
      <span
        aria-hidden="true"
        className="bg-muted-foreground/60 inline-block size-2 shrink-0 rounded-full"
      />
      <span>You&apos;re offline — changes are saved locally and will sync when you reconnect.</span>
    </div>
  )
}
