"use client"

import { useEffect, useState } from "react"

import type { DocHeading } from "@/lib/docs"

/**
 * Scroll-spy table of contents. The headings are server-rendered with
 * `data-doc-heading`; this component only tracks which one is in view.
 */
export function DocsOnThisPage({ headings }: { headings: DocHeading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "")

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-heading]"))
    if (elements.length === 0) return

    const ids = new Set(elements.map((element) => element.id))
    const visible = new Set<string>()
    let frame = 0

    const pickActive = () => {
      const firstVisible = elements.find((element) => visible.has(element.id))
      if (firstVisible) {
        setActive(firstVisible.id)
        return
      }

      // Nothing intersects (short sections, or the end of the page): use the
      // last heading that has passed the sticky header.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom) {
        setActive(elements[elements.length - 1]?.id ?? "")
        return
      }

      let current = elements[0].id
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= 96) current = element.id
      }
      setActive(current)
    }

    const schedulePick = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(pickActive)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        schedulePick()
      },
      { rootMargin: "-88px 0px -55% 0px", threshold: 0 },
    )

    for (const element of elements) observer.observe(element)

    const syncHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      if (id && ids.has(id)) {
        setActive(id)
        return
      }
      pickActive()
    }

    syncHash()
    window.addEventListener("hashchange", syncHash)
    window.addEventListener("scroll", schedulePick, { passive: true })

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("hashchange", syncHash)
      window.removeEventListener("scroll", schedulePick)
    }
  }, [])

  return (
    <nav className="doc-on-page" aria-labelledby="doc-on-page-title">
      <h4 id="doc-on-page-title">On this page</h4>
      <ul>
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              aria-current={active === heading.id ? "location" : undefined}
            >
              {heading.title}
            </a>
          </li>
        ))}
      </ul>
      <a className="doc-back-to-top" href="#top">
        <svg className="icon icon--xs" aria-hidden="true">
          <use href="#i-arrow-down" />
        </svg>
        Back to top
      </a>
    </nav>
  )
}
