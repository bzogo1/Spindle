"use client"

import dynamic from "next/dynamic"

/**
 * Mounts the deferred marketing stylesheets after hydration.
 *
 * `ssr: false` keeps `styles.css`/`auth.css` out of the render-blocking CSS
 * for the `(site)` group; first paint is styled by the critical CSS inlined
 * in the layout `<head>`. The chunk (and its CSS) loads immediately on
 * hydration, so the window of unstyled below-fold content is short.
 */
const DeferredSiteStyles = dynamic(
  () => import("./deferred-site-styles").then((mod) => mod.DeferredSiteStyles),
  { ssr: false },
)

export function DeferredStylesLoader() {
  return <DeferredSiteStyles />
}
