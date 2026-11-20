"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { ChevronLeft } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

/**
 * How close to the left edge (px) a touch must start before a rightward swipe
 * is treated as an "open drawer" gesture. Kept small so horizontal scrollers
 * and carousels elsewhere on the screen are unaffected.
 */
const EDGE_OPEN_PX = 24
/** Minimum horizontal travel (px) for a swipe to count. */
const SWIPE_THRESHOLD_PX = 50
/** Horizontal travel must dominate vertical travel by this factor. */
const AXIS_DOMINANCE = 1.5

type SwipeGesture = {
  pointerId: number
  startX: number
  startY: number
}

/**
 * Left slide-in navigation drawer for small viewports, built on Radix Dialog
 * so it inherits the focus trap, Escape-to-close, focus return, modal scroll
 * lock, `role="dialog"` / `aria-modal`, and outside-pointer dismissal.
 *
 * Adds pointer swipe gestures on top:
 * - swipe right starting within {@link EDGE_OPEN_PX} of the left edge opens
 *   the drawer (only while it is closed),
 * - swipe left anywhere while it is open closes it.
 *
 * Only touch/pen pointers participate so mouse text-selection drags near the
 * screen edge never trigger the drawer.
 */
export function MobileNavDrawer({
  open,
  onOpenChange,
  trigger,
  children,
  title = "Navigation",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rendered inside `DialogPrimitive.Trigger asChild` — must accept a ref. */
  trigger: ReactNode
  children: ReactNode
  title?: string
}) {
  const gesture = useRef<SwipeGesture | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse") return
      const qualifies = openRef.current || event.clientX <= EDGE_OPEN_PX
      if (!qualifies || gesture.current) return
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      }
    }

    function onPointerUp(event: PointerEvent) {
      const current = gesture.current
      gesture.current = null
      if (!current || current.pointerId !== event.pointerId) return

      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
      if (Math.abs(dx) < Math.abs(dy) * AXIS_DOMINANCE) return

      if (openRef.current && dx < 0) {
        onOpenChangeRef.current(false)
      } else if (!openRef.current && dx > 0) {
        onOpenChangeRef.current(true)
      }
    }

    function onPointerCancel() {
      gesture.current = null
    }

    window.addEventListener("pointerdown", onPointerDown, { passive: true })
    window.addEventListener("pointerup", onPointerUp, { passive: true })
    window.addEventListener("pointercancel", onPointerCancel, { passive: true })
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerCancel)
    }
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-overlay" />
        <DialogPrimitive.Content
          className="app-drawer"
          aria-modal="true"
          aria-describedby={undefined}
        >
          <div className="app-drawer-head">
            <DialogPrimitive.Title className="app-drawer-title">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="app-icon-button" aria-label="Close navigation">
              <ChevronLeft aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
