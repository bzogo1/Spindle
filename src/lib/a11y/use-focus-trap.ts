"use client"

import { useEffect, useRef, type RefObject } from "react"

import { focusElement, getFocusableElements } from "./focus"

type FocusTrapOptions = {
  /** Whether the trap is currently active (e.g. the overlay is mounted). */
  active: boolean
  /** Element that wraps the overlay content; Tab cycles within it. */
  containerRef: RefObject<HTMLElement | null>
  /** Called when Escape is pressed inside the container. */
  onEscape?: () => void
  /** Element to focus on activation; defaults to the first focusable child. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Restore focus to the previously focused element on deactivate. Default true. */
  restoreFocus?: boolean
}

/**
 * Minimal focus trap for custom (non-Radix) overlays: moves focus into the
 * container on activation, keeps Tab / Shift+Tab cycling inside it, forwards
 * Escape to `onEscape`, and restores focus to the element that had focus
 * before the overlay opened.
 *
 * Prefer the Radix-based primitives in `src/components/ui` for new overlays —
 * they implement the full dialog contract. This hook exists for legacy custom
 * modals that cannot be migrated yet.
 */
export function useFocusTrap({
  active,
  containerRef,
  onEscape,
  initialFocusRef,
  restoreFocus = true,
}: FocusTrapOptions) {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = () => getFocusableElements(container)

    // Move focus into the overlay. Prefer an explicit target, then the first
    // focusable element, then the container itself so the dialog's
    // aria-labelledby name is announced.
    const initial = initialFocusRef?.current ?? focusables()[0]
    if (initial) {
      focusElement(initial)
    } else {
      // Nothing focusable inside: focus the container so the dialog's
      // accessible name (aria-labelledby) is announced.
      container.tabIndex = -1
      focusElement(container)
    }

    // Arrow function (not a hoisted declaration) so TS keeps the `container`
    // null-narrowing from the guard above inside the closure.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onEscapeRef.current?.()
        return
      }
      if (event.key !== "Tab") return

      const items = focusables()
      if (items.length === 0) {
        // Nothing focusable inside: keep focus pinned to the container.
        event.preventDefault()
        focusElement(container)
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement

      if (event.shiftKey) {
        if (current === first || !container.contains(current)) {
          event.preventDefault()
          focusElement(last)
        }
      } else if (current === last || !container.contains(current)) {
        event.preventDefault()
        focusElement(first)
      }
    }

    container.addEventListener("keydown", onKeyDown)
    return () => {
      container.removeEventListener("keydown", onKeyDown)
      if (restoreFocus && previouslyFocused?.isConnected) {
        focusElement(previouslyFocused)
      }
    }
    // containerRef and initialFocusRef are stable refs; `active` gates the trap.
  }, [active, restoreFocus])
}
