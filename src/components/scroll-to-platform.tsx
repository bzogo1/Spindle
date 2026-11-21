"use client"

import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"

/**
 * "Scroll to platform" cue rendered at the bottom edge of the homepage hero.
 * It fades out once the visitor scrolls past the fold; clicking it jumps to
 * the #platform section (native anchor — global smooth-scroll + scroll-padding
 * on <html> handle the motion and header offset).
 */
export function ScrollToPlatform() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setHidden(window.scrollY > 160)
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <a
      href="#platform"
      className={`scroll-to-platform${hidden ? " is-hidden" : ""}`}
      aria-label="Scroll to platform section"
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
    >
      <ChevronDown className="size-5" aria-hidden="true" />
    </a>
  )
}
