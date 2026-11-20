"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ScrollMetrics {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientHeight: number
  clientWidth: number
}

const EMPTY_METRICS: ScrollMetrics = {
  scrollTop: 0,
  scrollLeft: 0,
  scrollHeight: 0,
  scrollWidth: 0,
  clientHeight: 0,
  clientWidth: 0,
}

interface ScrollAreaContextValue {
  viewportRef: React.RefObject<HTMLDivElement | null>
  viewport: HTMLDivElement | null
  setViewport: (el: HTMLDivElement | null) => void
  metrics: ScrollMetrics
  updateMetrics: (next?: Partial<ScrollMetrics>) => void
  isScrolling: boolean
  isDragging: boolean
  setActivity: (active: boolean) => void
  setDragging: (dragging: boolean) => void
  hovering: boolean
  hideDelay: number
  edgeFade: boolean
  edgeFadeSize: number
  prefersReducedMotion: boolean
}

const ScrollAreaContext = React.createContext<ScrollAreaContextValue | null>(null)

function useScrollAreaContext(component: string) {
  const ctx = React.useContext(ScrollAreaContext)
  if (!ctx) {
    throw new Error(`${component} must be used within a <ScrollArea>`)
  }
  return ctx
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return reduced
}

/* ------------------------------------------------------------------ */
/* Imperative handle                                                   */
/* ------------------------------------------------------------------ */

export interface ScrollAreaHandle {
  /**
   * Scroll the viewport. Accepts either a `ScrollToOptions` object or
   * `(x, y)` coordinates, mirroring `Element.scrollTo`.
   */
  scrollTo: {
    (options?: ScrollToOptions): void
    (x: number, y: number): void
  }
  /** Scroll so that the given element is visible inside the viewport. */
  scrollToElement: (
    element: HTMLElement | null | undefined,
    options?: ScrollToOptions & {
      block?: ScrollLogicalPosition
      inline?: ScrollLogicalPosition
    },
  ) => void
}

function performScroll(viewport: HTMLDivElement, x: number, y: number, behavior: ScrollBehavior) {
  const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  // Only clamp the upper bound when the viewport actually reports overflow;
  // environments without layout (jsdom) report 0 and should still accept
  // programmatic scroll offsets.
  const left = maxLeft > 0 ? Math.min(Math.max(x, 0), maxLeft) : Math.max(x, 0)
  const top = maxTop > 0 ? Math.min(Math.max(y, 0), maxTop) : Math.max(y, 0)

  if (typeof viewport.scrollTo === "function") {
    viewport.scrollTo({ left, top, behavior })
    return
  }
  // jsdom / environments without Element.scrollTo: assign directly.
  viewport.scrollLeft = left
  viewport.scrollTop = top
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

const scrollAreaVariants = cva("relative overflow-hidden", {
  variants: {
    size: {
      default: "",
      sm: "rounded-md",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

interface ScrollAreaProps
  extends React.ComponentProps<"div">, VariantProps<typeof scrollAreaVariants> {
  /** Milliseconds the scrollbars stay visible after the last scroll activity. */
  hideDelay?: number
  /** Fade content at edges that have more content beyond them. */
  edgeFade?: boolean
  /** Fade size in px when `edgeFade` is enabled. */
  edgeFadeSize?: number
}

const ScrollArea = React.forwardRef<ScrollAreaHandle, ScrollAreaProps>(function ScrollArea(
  {
    className,
    size,
    hideDelay = 600,
    edgeFade = false,
    edgeFadeSize = 32,
    children,
    onMouseEnter,
    onMouseLeave,
    ...props
  },
  ref,
) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const [viewport, setViewportState] = React.useState<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = React.useState<ScrollMetrics>(EMPTY_METRICS)
  const [isScrolling, setIsScrolling] = React.useState(false)
  const [isDragging, setIsDragging] = React.useState(false)
  const [hovering, setHovering] = React.useState(false)
  const prefersReducedMotion = usePrefersReducedMotion()
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimer = React.useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const setActivity = React.useCallback(
    (active: boolean) => {
      clearHideTimer()
      setIsScrolling(active)
      if (active) {
        hideTimer.current = setTimeout(() => {
          setIsScrolling(false)
          hideTimer.current = null
        }, hideDelay)
      }
    },
    [clearHideTimer, hideDelay],
  )

  const updateMetrics = React.useCallback((next?: Partial<ScrollMetrics>) => {
    const el = viewportRef.current
    const base: ScrollMetrics = el
      ? {
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          scrollHeight: el.scrollHeight,
          scrollWidth: el.scrollWidth,
          clientHeight: el.clientHeight,
          clientWidth: el.clientWidth,
        }
      : EMPTY_METRICS
    setMetrics({ ...base, ...next })
  }, [])

  const setViewport = React.useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el
    setViewportState(el)
  }, [])

  /* Initial metrics + observe viewport/content size changes. */
  React.useEffect(() => {
    if (!viewport) return
    updateMetrics()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => updateMetrics())
    observer.observe(viewport)
    const content = viewport.firstElementChild
    if (content instanceof HTMLElement) observer.observe(content)
    return () => observer.disconnect()
  }, [viewport, updateMetrics])

  React.useEffect(() => clearHideTimer, [clearHideTimer])

  const handleMouseEnter = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setHovering(true)
      onMouseEnter?.(event)
    },
    [onMouseEnter],
  )

  const handleMouseLeave = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setHovering(false)
      onMouseLeave?.(event)
    },
    [onMouseLeave],
  )

  const resolveBehavior = React.useCallback(
    (behavior?: ScrollBehavior): ScrollBehavior => {
      if (prefersReducedMotion) return "auto"
      return behavior ?? "smooth"
    },
    [prefersReducedMotion],
  )

  React.useImperativeHandle(
    ref,
    () => ({
      scrollTo(arg?: ScrollToOptions | number, y?: number) {
        const el = viewportRef.current
        if (!el) return
        const behavior = resolveBehavior(typeof arg === "object" ? arg?.behavior : undefined)
        if (typeof arg === "number" && typeof y === "number") {
          performScroll(el, arg, y, behavior)
        } else {
          const opts: ScrollToOptions = typeof arg === "object" && arg !== null ? arg : {}
          performScroll(el, opts?.left ?? el.scrollLeft, opts?.top ?? el.scrollTop, behavior)
        }
      },
      scrollToElement(
        element: HTMLElement | null | undefined,
        options?: ScrollToOptions & {
          block?: ScrollLogicalPosition
          inline?: ScrollLogicalPosition
        },
      ) {
        const el = viewportRef.current
        if (!el || !element) return
        const behavior = resolveBehavior(options?.behavior)
        const viewportRect = el.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        const block = options?.block ?? "nearest"
        const inline = options?.inline ?? "nearest"

        let top = el.scrollTop
        if (block === "start") {
          top = el.scrollTop + rect.top - viewportRect.top
        } else if (block === "end") {
          top = el.scrollTop + rect.bottom - viewportRect.bottom
        } else if (block === "center") {
          top = el.scrollTop + rect.top - viewportRect.top - (el.clientHeight - rect.height) / 2
        } else {
          // nearest
          if (rect.top < viewportRect.top) {
            top = el.scrollTop + rect.top - viewportRect.top
          } else if (rect.bottom > viewportRect.bottom) {
            top = el.scrollTop + rect.bottom - viewportRect.bottom
          }
        }

        let left = el.scrollLeft
        if (inline === "start") {
          left = el.scrollLeft + rect.left - viewportRect.left
        } else if (inline === "end") {
          left = el.scrollLeft + rect.right - viewportRect.right
        } else if (inline === "center") {
          left = el.scrollLeft + rect.left - viewportRect.left - (el.clientWidth - rect.width) / 2
        } else {
          if (rect.left < viewportRect.left) {
            left = el.scrollLeft + rect.left - viewportRect.left
          } else if (rect.right > viewportRect.right) {
            left = el.scrollLeft + rect.right - viewportRect.right
          }
        }

        performScroll(el, left, top, behavior)
      },
    }),
    [resolveBehavior],
  )

  const contextValue = React.useMemo<ScrollAreaContextValue>(
    () => ({
      viewportRef,
      viewport,
      setViewport,
      metrics,
      updateMetrics,
      isScrolling,
      isDragging,
      setActivity,
      setDragging: setIsDragging,
      hovering,
      hideDelay,
      edgeFade,
      edgeFadeSize,
      prefersReducedMotion,
    }),
    [
      viewport,
      setViewport,
      metrics,
      updateMetrics,
      isScrolling,
      isDragging,
      setActivity,
      hovering,
      hideDelay,
      edgeFade,
      edgeFadeSize,
      prefersReducedMotion,
    ],
  )

  const scrollbarVisible = hovering || isScrolling || isDragging

  return (
    <ScrollAreaContext.Provider value={contextValue}>
      <div
        data-slot="scroll-area"
        data-edge-fade={edgeFade || undefined}
        className={cn(scrollAreaVariants({ size }), className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        {children}
        {/* Visibility state for consumers/tests */}
        <span data-slot="scroll-area-state" hidden data-visible={scrollbarVisible} />
      </div>
    </ScrollAreaContext.Provider>
  )
})

/* ------------------------------------------------------------------ */
/* Viewport                                                            */
/* ------------------------------------------------------------------ */

const viewportVariants = cva("size-full overflow-auto outline-none motion-safe:scroll-smooth")

function ScrollAreaViewport({
  className,
  children,
  onScroll,
  style,
  ...props
}: React.ComponentProps<"div">) {
  const ctx = useScrollAreaContext("ScrollAreaViewport")

  const maskStyle = React.useMemo<React.CSSProperties>(() => {
    if (!ctx.edgeFade) return {}
    const { metrics } = ctx
    const size = ctx.edgeFadeSize
    const fades: string[] = []
    const canScrollY = metrics.scrollHeight > metrics.clientHeight + 1
    const canScrollX = metrics.scrollWidth > metrics.clientWidth + 1
    const atTop = metrics.scrollTop <= 1
    const atBottom = metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1
    const atLeft = metrics.scrollLeft <= 1
    const atRight = metrics.scrollLeft + metrics.clientWidth >= metrics.scrollWidth - 1

    if (canScrollY && !atTop) {
      fades.push(`linear-gradient(to bottom, transparent, black ${size}px)`)
    }
    if (canScrollY && !atBottom) {
      fades.push(`linear-gradient(to top, transparent, black ${size}px)`)
    }
    if (canScrollX && !atLeft) {
      fades.push(`linear-gradient(to right, transparent, black ${size}px)`)
    }
    if (canScrollX && !atRight) {
      fades.push(`linear-gradient(to left, transparent, black ${size}px)`)
    }
    if (fades.length === 0) return {}
    return {
      maskImage: fades.join(", "),
      WebkitMaskImage: fades.join(", "),
      maskComposite: "intersect",
      WebkitMaskComposite: "source-in",
    }
  }, [ctx.edgeFade, ctx.edgeFadeSize, ctx.metrics])

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      ctx.updateMetrics()
      ctx.setActivity(true)
      onScroll?.(event)
    },
    [ctx.setActivity, ctx.updateMetrics, onScroll],
  )

  return (
    <div
      ref={ctx.setViewport}
      data-slot="scroll-area-viewport"
      // Keyboard users need a tab stop to scroll the region with the arrow
      // keys (WCAG 2.1.1); consumers can still override via props.
      tabIndex={0}
      className={cn(viewportVariants(), className)}
      style={{ ...maskStyle, ...style }}
      onScroll={handleScroll}
      {...props}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Scrollbar + Thumb                                                   */
/* ------------------------------------------------------------------ */

const scrollbarVariants = cva(
  "absolute z-10 flex touch-none select-none opacity-0 transition-opacity duration-200 data-[visible=true]:opacity-100",
  {
    variants: {
      orientation: {
        vertical: "inset-y-0 right-0 w-2.5 p-[3px]",
        horizontal: "inset-x-0 bottom-0 h-2.5 p-[3px]",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  },
)

function isScrollable(metrics: ScrollMetrics, orientation: "vertical" | "horizontal"): boolean {
  // Metrics are all zero before layout (e.g. jsdom) — assume scrollable so
  // scrollbars can still be shown during interaction.
  const unknown =
    metrics.scrollHeight === 0 &&
    metrics.scrollWidth === 0 &&
    metrics.clientHeight === 0 &&
    metrics.clientWidth === 0
  if (unknown) return true
  return orientation === "vertical"
    ? metrics.scrollHeight > metrics.clientHeight + 1
    : metrics.scrollWidth > metrics.clientWidth + 1
}

interface ScrollAreaScrollbarProps
  extends React.ComponentProps<"div">, VariantProps<typeof scrollbarVariants> {}

function ScrollAreaScrollbar({
  className,
  orientation = "vertical",
  children,
  ...props
}: ScrollAreaScrollbarProps) {
  const ctx = useScrollAreaContext("ScrollAreaScrollbar")
  const scrollable = isScrollable(ctx.metrics, orientation ?? "vertical")
  const visible = scrollable && (ctx.hovering || ctx.isScrolling || ctx.isDragging)

  return (
    <div
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      data-visible={scrollable ? visible : undefined}
      className={cn(
        scrollbarVariants({ orientation }),
        !scrollable && "pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

const thumbVariants = cva(
  "relative flex-1 rounded-full bg-border/60 transition-colors hover:bg-border data-[dragging=true]:bg-primary/70",
)

function ScrollAreaThumb({ className, style, ...props }: React.ComponentProps<"div">) {
  const ctx = useScrollAreaContext("ScrollAreaThumb")
  const { metrics, viewportRef } = ctx
  const dragState = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
  } | null>(null)
  const thumbRef = React.useRef<HTMLDivElement | null>(null)

  const isVertical = React.useCallback(() => {
    const el = thumbRef.current?.parentElement
    return el?.getAttribute("data-orientation") !== "horizontal"
  }, [])

  const ratio = React.useMemo(() => {
    const vp = viewportRef.current
    if (!vp) return { size: 0, offset: 0 }
    if (isVertical()) {
      const viewportRatio =
        vp.clientHeight > 0 && vp.scrollHeight > 0 ? vp.clientHeight / vp.scrollHeight : 1
      const size = Math.min(1, Math.max(0.08, viewportRatio))
      const maxScroll = Math.max(0, vp.scrollHeight - vp.clientHeight)
      const offset = maxScroll > 0 ? (vp.scrollTop / maxScroll) * (1 - size) : 0
      return { size: size * 100, offset: offset * 100 }
    }
    const viewportRatio =
      vp.clientWidth > 0 && vp.scrollWidth > 0 ? vp.clientWidth / vp.scrollWidth : 1
    const size = Math.min(1, Math.max(0.08, viewportRatio))
    const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth)
    const offset = maxScroll > 0 ? (vp.scrollLeft / maxScroll) * (1 - size) : 0
    return { size: size * 100, offset: offset * 100 }
  }, [isVertical, viewportRef, metrics])

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const vp = viewportRef.current
      if (!vp) return
      event.preventDefault()
      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: vp.scrollLeft,
        startScrollTop: vp.scrollTop,
      }
      ctx.setDragging(true)
      ctx.setActivity(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [ctx, viewportRef],
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const vp = viewportRef.current
      const drag = dragState.current
      if (!vp || !drag || drag.pointerId !== event.pointerId) return

      const track = thumbRef.current?.parentElement
      const trackPadding = 6 // p-[3px] on both sides
      if (isVertical()) {
        const trackSize = Math.max(1, (track?.clientHeight ?? vp.clientHeight) - trackPadding)
        const thumbSize = (ratio.size / 100) * trackSize
        const maxScroll = Math.max(1, vp.scrollHeight - vp.clientHeight)
        const delta =
          ((event.clientY - drag.startY) * maxScroll) / Math.max(1, trackSize - thumbSize)
        vp.scrollTop = drag.startScrollTop + delta
      } else {
        const trackSize = Math.max(1, (track?.clientWidth ?? vp.clientWidth) - trackPadding)
        const thumbSize = (ratio.size / 100) * trackSize
        const maxScroll = Math.max(1, vp.scrollWidth - vp.clientWidth)
        const delta =
          ((event.clientX - drag.startX) * maxScroll) / Math.max(1, trackSize - thumbSize)
        vp.scrollLeft = drag.startScrollLeft + delta
      }
      ctx.updateMetrics()
      ctx.setActivity(true)
    },
    [ctx, isVertical, ratio, viewportRef],
  )

  const endDrag = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragState.current?.pointerId !== event.pointerId) return
      dragState.current = null
      ctx.setDragging(false)
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    },
    [ctx],
  )

  const vertical = isVertical()

  return (
    <div
      ref={thumbRef}
      data-slot="scroll-area-thumb"
      data-dragging={ctx.isDragging || undefined}
      className={cn(thumbVariants(), className)}
      style={{
        ...(vertical
          ? {
              height: `${ratio.size}%`,
              transform: `translateY(${ratio.offset}%)`,
            }
          : {
              width: `${ratio.size}%`,
              transform: `translateX(${ratio.offset}%)`,
            }),
        ...style,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      {...props}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Corner                                                              */
/* ------------------------------------------------------------------ */

function ScrollAreaCorner({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area-corner"
      className={cn("absolute right-0 bottom-0 z-10 size-2.5", className)}
      {...props}
    />
  )
}

/* Backwards-compatible alias (older shadcn naming). */
const ScrollAreaScrollBar = ScrollAreaScrollbar

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

export {
  ScrollArea,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaScrollBar,
  ScrollAreaThumb,
  ScrollAreaCorner,
}
