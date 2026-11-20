"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

import { markTutorialCompleted } from "./completion"
import type { Tutorial, TutorialStep, TutorialStepPlacement } from "./types"

export type TutorialRunnerProps = {
  tutorial: Tutorial
  /** Whether the tour is currently running. */
  open: boolean
  /** Called when the user skips, presses Escape, or finishes the last step. */
  onClose: () => void
  /** Called after the final step completes (before onClose). */
  onComplete?: (tutorialId: string) => void
}

const SPOTLIGHT_PADDING = 8
const TOOLTIP_WIDTH = 320
const TOOLTIP_MARGIN = 12
const ESTIMATED_TOOLTIP_HEIGHT = 200

type Rect = {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

function findTarget(selector: string | undefined): Element | null {
  if (!selector || typeof document === "undefined") return null
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

function measure(el: Element): Rect | null {
  const rect = el.getBoundingClientRect()
  // jsdom and detached nodes report all-zero rects; treat those as "no
  // measurable target" so the tooltip falls back to centered.
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

function spotlightRect(rect: Rect): Rect {
  return {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
    bottom: rect.bottom + SPOTLIGHT_PADDING,
    right: rect.right + SPOTLIGHT_PADDING,
  }
}

function tooltipPosition(
  target: Rect | null,
  placement: TutorialStepPlacement,
  viewport: { width: number; height: number },
): {
  top?: number
  left?: number
  right?: number
  bottom?: number
  placement: TutorialStepPlacement
} {
  if (!target) return { placement: "auto" }

  const centerX = target.left + target.width / 2
  const left = Math.min(
    Math.max(centerX - TOOLTIP_WIDTH / 2, TOOLTIP_MARGIN),
    Math.max(viewport.width - TOOLTIP_WIDTH - TOOLTIP_MARGIN, TOOLTIP_MARGIN),
  )

  const fitsBelow = target.bottom + TOOLTIP_MARGIN + ESTIMATED_TOOLTIP_HEIGHT < viewport.height
  const fitsAbove = target.top - TOOLTIP_MARGIN - ESTIMATED_TOOLTIP_HEIGHT > 0

  const effective: TutorialStepPlacement =
    placement === "auto" ? (fitsBelow || !fitsAbove ? "bottom" : "top") : placement

  const clampTop = (value: number) =>
    Math.min(
      Math.max(value, TOOLTIP_MARGIN),
      Math.max(viewport.height - ESTIMATED_TOOLTIP_HEIGHT - TOOLTIP_MARGIN, TOOLTIP_MARGIN),
    )

  if (effective === "bottom") {
    return { top: target.bottom + TOOLTIP_MARGIN, left, placement: effective }
  }
  if (effective === "top") {
    return { bottom: viewport.height - target.top + TOOLTIP_MARGIN, left, placement: effective }
  }
  // left/right placements stack horizontally; fall back to bottom when the
  // viewport is too narrow.
  if (viewport.width < 720) {
    return { top: target.bottom + TOOLTIP_MARGIN, left, placement: "bottom" }
  }
  if (effective === "left") {
    return {
      top: clampTop(target.top - 40),
      right: viewport.width - target.left + TOOLTIP_MARGIN,
      placement: effective,
    }
  }
  return {
    top: clampTop(target.top - 40),
    left: target.right + TOOLTIP_MARGIN,
    placement: effective,
  }
}

/**
 * Step-by-step tutorial runner: dimmed overlay, spotlight ring around the
 * current step's target, tooltip with back/next/skip controls, progress
 * indicator, and localStorage-persisted completion.
 *
 * Built on the shared Radix `Dialog` primitive, so focus is trapped inside
 * the tooltip, Tab cycles through its controls, Escape skips, and focus is
 * restored to the previously focused element when the tour closes.
 *
 * Render it once near the root of the page that hosts the tour targets and
 * drive it with `open`/`onClose` from a start button.
 */
export function TutorialRunner({ tutorial, open, onClose, onComplete }: TutorialRunnerProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  // window.innerWidth/innerHeight are only safe to read after mount; the
  // fallback keeps SSR/first paint deterministic.
  const [mounted, setMounted] = useState(false)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // null sentinel so the capture also runs when the tour is open on first
  // render (prevOpen !== open on mount).
  const prevOpenRef = useRef<boolean | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Capture the element that had focus when the tour opened so it can be
  // restored on close. Done during render (before Radix mounts and moves
  // focus into the dialog) rather than in an effect, which would run after
  // the autofocus and capture the dialog itself.
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open
    if (open && typeof document !== "undefined") {
      const active = document.activeElement
      restoreFocusRef.current = active instanceof HTMLElement ? active : null
    }
  }

  // Restore focus when the tour closes or the runner unmounts. Radix's own
  // close-autofocus targets Dialog.Trigger (absent here), so without this
  // focus would drop to <body>.
  useEffect(() => {
    if (!open) return
    return () => {
      const el = restoreFocusRef.current
      restoreFocusRef.current = null
      if (el && (el.isConnected || document.contains(el))) {
        el.focus({ preventScroll: true })
      }
    }
  }, [open])

  const step: TutorialStep | undefined = tutorial.steps[stepIndex]
  const stepCount = tutorial.steps.length
  const isFirst = stepIndex === 0
  const isLast = stepIndex === stepCount - 1

  // Reset to the first step every time the tour opens.
  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open, tutorial.id])

  const measureTarget = useCallback(() => {
    const el = findTarget(step?.target)
    const rect = el ? measure(el) : null
    setTargetRect(rect)
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      } catch {
        // scrollIntoView can throw in jsdom; positioning still works.
      }
    }
  }, [step?.target])

  useLayoutEffect(() => {
    if (!open) return
    measureTarget()
    const onReflow = () => measureTarget()
    window.addEventListener("resize", onReflow)
    window.addEventListener("scroll", onReflow, true)
    return () => {
      window.removeEventListener("resize", onReflow)
      window.removeEventListener("scroll", onReflow, true)
    }
  }, [open, measureTarget])

  const goNext = useCallback(() => {
    if (isLast) {
      markTutorialCompleted(tutorial.id)
      onComplete?.(tutorial.id)
      onClose()
      return
    }
    setStepIndex((index) => index + 1)
  }, [isLast, onClose, onComplete, tutorial.id])

  const goBack = useCallback(() => {
    setStepIndex((index) => Math.max(0, index - 1))
  }, [])

  // Radix closes the dialog on Escape and outside interaction; route that
  // through onClose so the parent can unmount the runner.
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose()
    },
    [onClose],
  )

  if (!mounted || !open || !step) return null

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const spot = targetRect ? spotlightRect(targetRect) : null
  const tip = tooltipPosition(targetRect, step.placement ?? "auto", viewport)
  const progress = stepCount > 0 ? ((stepIndex + 1) / stepCount) * 100 : 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="tutorial-runner"
          aria-label={tutorial.title}
          tabIndex={-1}
          // Prevent Radix from stealing focus to the first focusable child
          // inconsistently — we want the tooltip itself focused initially.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            ;(event.currentTarget as HTMLElement).focus()
          }}
          // A tour should only end via its own controls, Done, or Escape —
          // not by an accidental click on the dimmed backdrop.
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          {/* Dimmed backdrop; the spotlight is a separate accent ring so the
              target stays visible under the dim layer. */}
          <div className="tutorial-backdrop" aria-hidden="true" />
          {spot ? (
            <div
              className="tutorial-spotlight"
              aria-hidden="true"
              style={{
                top: spot.top,
                left: spot.left,
                width: spot.width,
                height: spot.height,
              }}
            />
          ) : null}

          <div
            className={cn(
              "tutorial-tooltip",
              tip.placement === "auto" && "tutorial-tooltip--center",
            )}
            style={
              tip.placement === "auto"
                ? undefined
                : {
                    top: tip.top,
                    left: tip.left,
                    right: tip.right,
                    bottom: tip.bottom,
                  }
            }
          >
            <div className="tutorial-tooltip-head">
              <span className="tutorial-step-count">
                Step {stepIndex + 1} of {stepCount}
              </span>
              <button
                type="button"
                className="tutorial-skip"
                onClick={onClose}
                aria-label="Skip tutorial"
              >
                Skip
              </button>
            </div>

            <div
              className="tutorial-progress"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={stepCount}
              aria-valuenow={stepIndex + 1}
              aria-label="Tutorial progress"
            >
              <div className="tutorial-progress-bar" style={{ width: `${progress}%` }} />
            </div>

            {/* aria-live announces each new step's title and body to
                screen readers as the tour advances. */}
            <div className="tutorial-step-body" aria-live="polite" aria-atomic="true">
              <h3 className="tutorial-step-title">{step.title}</h3>
              <p className="tutorial-step-content">{step.content}</p>
            </div>

            <div className="tutorial-actions">
              <button
                type="button"
                className="btn btn--ghost tutorial-back"
                onClick={goBack}
                disabled={isFirst}
              >
                Back
              </button>
              <button type="button" className="btn btn--primary tutorial-next" onClick={goNext}>
                {isLast ? "Done" : "Next"}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
