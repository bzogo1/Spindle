"use client"

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"

/**
 * Pointer- and keyboard-driven width resizing for the builder's side panels.
 * `useResizableWidth` returns the current width plus `handleProps` to spread
 * onto a `role="separator"` drag handle; dragging (or arrow keys) adjusts the
 * adjacent pane within [min, max]. Double-click resets to `initial`.
 */

export interface ResizableWidthOptions {
  /** Starting width in px. */
  initial?: number
  min?: number
  max?: number
  /**
   * Which side of the handle the resizable pane sits on. "right" means the
   * pane is to the right of the handle, so dragging left widens it.
   */
  side?: "left" | "right"
  /** Keyboard step in px per arrow press. */
  step?: number
  /** Accessible label for the separator. */
  label?: string
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function useResizableWidth({
  initial = 288,
  min = 220,
  max = 560,
  side = "right",
  step = 16,
  label = "Resize panel",
}: ResizableWidthOptions = {}) {
  const [width, setWidth] = useState(initial)
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      const dx = event.clientX - current.startX
      const delta = side === "right" ? -dx : dx
      setWidth(clamp(current.startWidth + delta, min, max))
    },
    [min, max, side],
  )

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // For a right-side pane, ArrowLeft widens and ArrowRight narrows.
      const direction = side === "right" ? -1 : 1
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        setWidth((current) => clamp(current + direction * step, min, max))
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        setWidth((current) => clamp(current - direction * step, min, max))
      } else if (event.key === "Home") {
        event.preventDefault()
        setWidth(min)
      } else if (event.key === "End") {
        event.preventDefault()
        setWidth(max)
      }
    },
    [min, max, side, step],
  )

  const onDoubleClick = useCallback(() => setWidth(initial), [initial])

  return {
    width,
    handleProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": label,
      "aria-valuenow": width,
      "aria-valuemin": min,
      "aria-valuemax": max,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick,
    },
  }
}
