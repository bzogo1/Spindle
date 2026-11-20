"use client"

/**
 * View Transitions building blocks (Next.js 16 / React 19.3).
 *
 * How it fits together:
 * - Next route navigations are React transitions, so `<ViewTransition>`
 *   animates automatically during navigation — no router config needed.
 * - `PageTransition` wraps a page's content and maps the `nav-forward` /
 *   `nav-back` transition types (set via `<Link transitionTypes>` or
 *   `router.push(url, { transitionTypes })`) to directional slides. Put it in
 *   each `page.tsx`, never in a layout (layouts persist, so enter/exit never
 *   fire there).
 * - `SharedElement` gives an element a stable `view-transition-name` so it
 *   morphs between the old and new page. Use the same `viewTransitionName()`
 *   value on both sides. Keep names unique per page instance.
 * - Async data: pages that suspend into a fallback simply don't pair named
 *   elements on that navigation — the content plays its enter animation
 *   instead. Wrap loading boundaries in `ViewTransition` (see the Suspense
 *   reveal pattern in `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`).
 * - Scroll: the App Router restores scroll position on back/forward
 *   navigations and scrolls to top on new navigations, inside and outside
 *   view transitions — no extra work needed.
 * - Fallback: unsupported browsers render plain children; React's
 *   `<ViewTransition>` also no-ops internally, so there is no broken state.
 *   `prefers-reduced-motion` is handled in `styles/view-transitions.css`.
 */

import { ViewTransition } from "react"
import type { ReactNode } from "react"

import { NAV_BACK, NAV_FORWARD } from "./vt-support"
import { useViewTransitionSupported } from "./use-view-transition-supported"

const DIRECTIONAL = {
  [NAV_FORWARD]: "nav-forward",
  [NAV_BACK]: "nav-back",
  default: "none",
} as const

/**
 * Wraps a page's content so `nav-forward`/`nav-back` transition types slide
 * the page in the matching direction. Navigations without a type (browser
 * back button, `router.refresh()`, Suspense reveals) get `default: "none"`
 * and change instantly.
 *
 * Renders children unwrapped when view transitions are unsupported.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const supported = useViewTransitionSupported()
  if (!supported) return <>{children}</>
  return (
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none">
      {children}
    </ViewTransition>
  )
}

/**
 * Marks an element as a shared element that morphs between pages.
 *
 * `name` must be identical on the origin and destination (use
 * `viewTransitionName(scope, id)` from `./vt-support`). `share="morph"` +
 * `default="none"` opts the pair into the `.morph` CSS class and prevents
 * the element from animating during unrelated transitions — keep both props
 * together or the pair silently stops morphing.
 */
export function SharedElement({ name, children }: { name: string; children: ReactNode }) {
  const supported = useViewTransitionSupported()
  if (!supported) return <>{children}</>
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  )
}
