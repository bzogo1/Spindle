"use client"

import "@/app/styles/styles.css"
import "@/app/styles/auth.css"

/**
 * Non-critical marketing stylesheets, loaded as an async chunk.
 *
 * This module is only reachable through `next/dynamic(..., { ssr: false })`
 * in `deferred-styles-loader.tsx`, so `styles.css` + `auth.css` ship in a
 * separate CSS asset that the browser fetches after first paint instead of
 * blocking it. Above-the-fold styling is covered by the inlined critical CSS
 * in `src/lib/critical-css.ts`.
 */
export function DeferredSiteStyles() {
  return null
}
