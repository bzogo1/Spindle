"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

/**
 * Bottom-anchored sheet for small viewports — the mobile counterpart of
 * `Dialog`. Built on the same Radix Dialog primitive, so it inherits the
 * focus trap, Escape handling, focus return, scroll lock, and
 * `role="dialog"` / `aria-modal` semantics for free.
 *
 * Adds a drag handle and a swipe-down-to-dismiss gesture (touch/pen only):
 * a downward swipe that travels at least {@link SWIPE_CLOSE_PX} px and
 * dominates the horizontal axis closes the sheet. Pair it with a
 * `@media (max-width: …)` wrapper or render it only on small screens — the
 * component itself is viewport-agnostic.
 */

const SWIPE_CLOSE_PX = 60
const AXIS_DOMINANCE = 1.5

function BottomSheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="bottom-sheet" {...props} />
}

function BottomSheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="bottom-sheet-trigger" {...props} />
}

function BottomSheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="bottom-sheet-portal" {...props} />
}

function BottomSheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="bottom-sheet-close" {...props} />
}

function BottomSheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="bottom-sheet-overlay"
      className={cn("ui-bottom-sheet-overlay", className)}
      {...props}
    />
  )
}

function BottomSheetContent({
  className,
  children,
  showCloseButton = true,
  showHandle = true,
  onSwipeDown,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Render the decorative drag handle at the top of the sheet. */
  showHandle?: boolean
  /**
   * Fired when a downward swipe (touch/pen) starting inside the sheet
   * crosses the close threshold. Wire it to your `open` state, e.g.
   * `onSwipeDown={() => setOpen(false)}`.
   */
  onSwipeDown?: () => void
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const onSwipeDownRef = React.useRef(onSwipeDown)
  onSwipeDownRef.current = onSwipeDown
  const gesture = React.useRef<{ pointerId: number; startY: number; startX: number } | null>(null)

  React.useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse") return
      if (!contentRef.current?.contains(event.target as Node)) return
      gesture.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startX: event.clientX,
      }
    }

    function onPointerUp(event: PointerEvent) {
      const current = gesture.current
      gesture.current = null
      if (!current || current.pointerId !== event.pointerId) return
      const dy = event.clientY - current.startY
      const dx = event.clientX - current.startX
      if (dy < SWIPE_CLOSE_PX) return
      if (dy < Math.abs(dx) * AXIS_DOMINANCE) return
      onSwipeDownRef.current?.()
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
    <BottomSheetPortal data-slot="bottom-sheet-portal">
      <BottomSheetOverlay />
      <DialogPrimitive.Content
        ref={contentRef}
        data-slot="bottom-sheet-content"
        aria-modal="true"
        className={cn("ui-bottom-sheet", className)}
        {...props}
      >
        {showHandle ? (
          <div className="ui-bottom-sheet-handle" aria-hidden="true">
            <span />
          </div>
        ) : null}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="bottom-sheet-close" className="ui-bottom-sheet-close">
            <XIcon aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </BottomSheetPortal>
  )
}

function BottomSheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bottom-sheet-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function BottomSheetFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="bottom-sheet-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <button type="button" className="ui-bottom-sheet-dismiss">
            Close
          </button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function BottomSheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="bottom-sheet-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function BottomSheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="bottom-sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  BottomSheet,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetOverlay,
  BottomSheetPortal,
  BottomSheetTitle,
  BottomSheetTrigger,
}
