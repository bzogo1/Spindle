"use client"

import { useSyncExternalStore } from "react"

import { canUseViewTransitions } from "./vt-support"

function subscribe() {
  // Support cannot change during a session; nothing to subscribe to.
  return () => {}
}

/**
 * Whether the current browser supports view transitions.
 *
 * Uses `useSyncExternalStore` with a `false` server snapshot so SSR and the
 * hydration render match (children render plainly), then upgrades to
 * `<ViewTransition>` after mount on supporting browsers. Returning `false`
 * on the server is safe: named view transitions only matter once a
 * navigation happens, which is always post-hydration.
 */
export function useViewTransitionSupported(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => canUseViewTransitions(),
    () => false,
  )
}
