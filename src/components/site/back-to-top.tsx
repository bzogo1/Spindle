"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp } from "lucide-react"

/**
 * Floating "back to top" button for the homepage. Appears once the visitor
 * scrolls past the hero section and smooth-scrolls back to the top.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false)
  const frame = useRef(0)
  const threshold = useRef(0)

  useEffect(() => {
    const measure = () => {
      const hero = document.querySelector(".hero")
      threshold.current = hero
        ? hero.getBoundingClientRect().bottom + window.scrollY
        : window.innerHeight
    }

    const onScroll = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        setVisible(window.scrollY > threshold.current)
      })
    }

    const onResize = () => {
      measure()
      onScroll()
    }

    measure()
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onResize)

    return () => {
      cancelAnimationFrame(frame.current)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <button
      type="button"
      className={`back-to-top${visible ? " is-visible" : ""}`}
      aria-label="Back to top"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={scrollToTop}
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </button>
  )
}
