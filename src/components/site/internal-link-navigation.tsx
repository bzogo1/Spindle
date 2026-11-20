"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { NAV_FORWARD } from "@/components/view-transitions/vt-support"

/**
 * Turns plain `<a href="/...">` clicks inside the marketing site into client
 * navigations tagged with the `nav-forward` view-transition type.
 *
 * Most site markup predates `next/link` and uses bare anchors, which would
 * otherwise force a full page load and bypass view transitions entirely.
 * Intercepting at the document level upgrades every internal link — nav,
 * CTAs, footer, in-content links — without touching ~100 call sites.
 *
 * Skipped: modified clicks (new tab/window), non-left buttons, `target`,
 * `download`, external URLs, `/api` and `/_next` paths, and same-page hash
 * jumps (the browser's native anchor scroll is faster and needs no router).
 */
export function InternalLinkNavigation() {
  const router = useRouter()

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target as Element | null
      const anchor = target?.closest?.("a[href]")
      if (!anchor || anchor instanceof SVGElement) return
      if (anchor.getAttribute("target") === "_blank") return
      if (anchor.hasAttribute("download")) return
      if (anchor.hasAttribute("data-no-client-nav")) return

      const href = anchor.getAttribute("href") ?? ""
      // Only root-relative paths are ours; everything else (absolute URLs,
      // mailto:, tel:, protocol-relative) keeps its native behavior.
      if (!href.startsWith("/") || href.startsWith("//")) return

      let url: URL
      try {
        url = new URL(href, window.location.origin)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) {
        return
      }

      // Same-page hash navigation: let the browser scroll natively.
      if (url.pathname === window.location.pathname && url.hash) return

      event.preventDefault()
      router.push(`${url.pathname}${url.search}${url.hash}`, {
        transitionTypes: [NAV_FORWARD],
      })
    }

    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [router])

  return null
}
