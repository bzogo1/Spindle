"use client"

import { useEffect, useState } from "react"

/**
 * Radix Dialog/Drawer primitives portal their content to `document.body`
 * with `role="dialog"`/`aria-modal="true"` and a `data-state` attribute.
 * The app shell uses this hook to dim the page while any modal or drawer
 * is open. A MutationObserver re-checks on DOM changes because overlay
 * content mounts and unmounts outside this component's React tree.
 */
const MODAL_SELECTOR = '[role="dialog"], [aria-modal="true"]'

function hasOpenModal() {
  return Array.from(document.querySelectorAll(MODAL_SELECTOR)).some(
    // Elements mid exit-animation carry data-state="closed"; treat them as
    // already dismissed so the dim lifts with the closing animation.
    (el) => el.getAttribute("data-state") !== "closed",
  )
}

export function useModalOpen() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const update = () => setOpen(hasOpenModal())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-modal", "role"],
    })
    return () => observer.disconnect()
  }, [])

  return open
}
