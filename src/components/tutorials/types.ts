/**
 * Shared types for the interactive tutorial engine.
 */

export type TutorialStepPlacement = "top" | "bottom" | "left" | "right" | "auto"

export type TutorialStep = {
  /** Stable step id within the tutorial. */
  id: string
  /**
   * CSS selector for the element to spotlight. When omitted — or when the
   * selector matches nothing — the tooltip is centered on screen without a
   * spotlight ring.
   */
  target?: string
  title: string
  /** Tooltip body. Plain text rendered as a paragraph (markup is escaped). */
  content: string
  /** Preferred tooltip side relative to the target. Defaults to "auto". */
  placement?: TutorialStepPlacement
}

export type Tutorial = {
  /** Stable tutorial id; also the localStorage completion key suffix. */
  id: string
  title: string
  description?: string
  steps: TutorialStep[]
}
