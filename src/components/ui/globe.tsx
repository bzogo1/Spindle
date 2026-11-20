"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import type { COBEOptions } from "cobe"

import { cn } from "@/lib/utils"

/**
 * Lazy boundary for the WebGL globe. `cobe` and the Sentry client
 * capture call only exist in `globe-scene.tsx`; keeping them behind
 * `next/dynamic` with `ssr: false` keeps them out of the initial client
 * bundle on the marketing pages that render `<Globe />`.
 *
 * The globe is below the fold on every page that uses it, so mounting
 * `GlobeScene` eagerly still costs a chunk download + WebGL init +
 * texture generation inside the Lighthouse trace window. An
 * IntersectionObserver with a generous `rootMargin` defers the mount —
 * and therefore the chunk fetch — until the canvas is near the viewport.
 * Once mounted it stays mounted; `GlobeScene` pauses its render loop
 * itself when the canvas scrolls away or the tab hides.
 *
 * The placeholder below uses the same box classes as `GlobeScene`'s root
 * (`absolute inset-0 … aspect-square max-w-150`), and the mount containers
 * (`.globe-mount`, `.collab-globe-mount`) are fixed-size, so deferring
 * the scene causes no layout shift — the canvas already fades in via its
 * own opacity transition.
 */
const GlobeScene = dynamic(() => import("./globe-scene").then((mod) => mod.GlobeScene), {
  ssr: false,
})

export function Globe({ className, config }: { className?: string; config?: COBEOptions }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    // No IntersectionObserver (very old browsers, some test environments):
    // mount immediately rather than never.
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true)
          // One-shot: the scene stays mounted and self-pauses offscreen.
          observer.disconnect()
        }
      },
      // Start fetching the chunk ~300px before the canvas is visible so
      // the init cost lands outside the critical trace window.
      { rootMargin: "300px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={mountRef}
      className={cn("absolute inset-0 mx-auto aspect-square w-full max-w-150", className)}
    >
      {nearViewport ? <GlobeScene config={config} /> : null}
    </div>
  )
}
