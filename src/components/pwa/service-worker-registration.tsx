"use client"

import { useEffect, useRef, useState } from "react"

import { clientEnv } from "@/lib/env"
import { installBackgroundSync, startOutboxPolling } from "@/lib/pwa/background-sync"

const SERVICE_WORKER_URL = "/sw.js"
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Registers the production service worker and surfaces the update flow.
 *
 * - Registers /sw.js only in production builds (dev servers must never cache).
 * - When a new worker reaches `installed` while an old one controls the page,
 *   shows a small reload prompt; confirming posts SKIP_WAITING and reloads on
 *   `controllerchange`.
 * - Also installs the fetch interceptor that queues failed mutations into the
 *   background-sync outbox (src/lib/pwa/background-sync.ts).
 *
 * Renders nothing until an update is waiting, so it is safe to mount in every
 * root layout.
 */
export function ServiceWorkerRegistration() {
  const [updateWaiting, setUpdateWaiting] = useState<ServiceWorker | null>(null)
  const reloadingRef = useRef(false)

  useEffect(() => {
    // Production builds only — the dev server must never serve a caching SW.
    if (clientEnv.NODE_ENV !== "production") return
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

    let cancelled = false
    let unregisterSync: (() => void) | undefined
    let stopUpdateChecks: (() => void) | undefined
    let stopOutboxPolling: (() => void) | undefined

    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/" })
      .then((registration) => {
        if (cancelled) return

        // A waiting worker means a new version is ready to take over.
        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateWaiting(registration.waiting)
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener("statechange", () => {
            // "installed" + an existing controller = update, not first install.
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateWaiting(installing)
            }
          })
        })

        // Periodic + visibility-driven update checks keep long-lived tabs fresh.
        const checkForUpdates = () => {
          registration.update().catch(() => {})
        }
        const interval = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
        const onVisible = () => {
          if (document.visibilityState === "visible") checkForUpdates()
        }
        document.addEventListener("visibilitychange", onVisible)
        stopUpdateChecks = () => {
          window.clearInterval(interval)
          document.removeEventListener("visibilitychange", onVisible)
        }
      })
      .catch(() => {
        // SW registration failure must never break the page.
      })

    // Reload once the new worker takes control.
    const onControllerChange = () => {
      if (reloadingRef.current) return
      reloadingRef.current = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

    // Queue failed mutations for background replay.
    unregisterSync = installBackgroundSync()

    // Fallback replay for browsers without Background Sync: drain the outbox
    // on `online` events and on an interval while the tab is open.
    stopOutboxPolling = startOutboxPolling()

    return () => {
      cancelled = true
      stopUpdateChecks?.()
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      unregisterSync?.()
      stopOutboxPolling?.()
    }
  }, [])

  if (!updateWaiting) return null

  return (
    <div
      role="status"
      className="border-border bg-card text-card-foreground fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm shadow-lg"
    >
      <span>A new version of Spindle is available.</span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium"
          onClick={() => updateWaiting.postMessage({ type: "SKIP_WAITING" })}
        >
          Reload
        </button>
        <button
          type="button"
          aria-label="Dismiss update prompt"
          className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5 text-xs"
          onClick={() => setUpdateWaiting(null)}
        >
          Later
        </button>
      </span>
    </div>
  )
}
