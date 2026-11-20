"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { AwarenessState } from "@/lib/collab/awareness"

export interface PresenceCursorEntry {
  clientId: string
  state: AwarenessState
}

export interface CursorPoint {
  x: number
  y: number
}

export interface PresenceCursorsProps {
  /** Remote (and optionally local) presence states to render. */
  entries: PresenceCursorEntry[]
  /**
   * Map a character index in the document to a pixel position relative to
   * the top-left of the text area. Provided by the parent (which owns the
   * editor's text metrics).
   */
  toPosition: (index: number) => CursorPoint
  /** Pixel height of one line — used for caret height and selection rects. */
  lineHeight?: number
  className?: string
}

/**
 * Overlay rendering remote carets and selections.
 *
 * Positions are supplied by the parent via `toPosition`, so this component
 * stays presentation-only and works with any editor backend (textarea,
 * contenteditable, code mirror, …).
 */
export function PresenceCursors({
  entries,
  toPosition,
  lineHeight = 20,
  className,
}: PresenceCursorsProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {entries.map(({ clientId, state }) => {
        const color = state.user.color
        const name = state.user.name
        const caret = state.cursor ?? null
        const sel = state.selection ?? null

        // Selection highlight: bounding box between anchor and head.
        let selRect: { left: number; top: number; width: number; height: number } | null = null
        if (sel && sel.anchor !== sel.head) {
          const a = toPosition(Math.min(sel.anchor, sel.head))
          const b = toPosition(Math.max(sel.anchor, sel.head))
          const top = Math.min(a.y, b.y)
          const bottom = Math.max(a.y, b.y) + lineHeight
          selRect = {
            left: Math.min(a.x, b.x),
            top,
            width: Math.max(2, Math.abs(b.x - a.x) || Math.abs(b.y - a.y)),
            height: bottom - top,
          }
        }

        const caretPos = caret != null ? toPosition(caret) : null

        return (
          <React.Fragment key={clientId}>
            {selRect && (
              <div
                className="absolute opacity-25"
                style={{
                  left: selRect.left,
                  top: selRect.top,
                  width: selRect.width,
                  height: selRect.height,
                  backgroundColor: color,
                }}
              />
            )}
            {caretPos && (
              <>
                <div
                  className="absolute w-[2px] rounded-full"
                  style={{
                    left: caretPos.x,
                    top: caretPos.y,
                    height: lineHeight,
                    backgroundColor: color,
                  }}
                />
                <div
                  className="absolute rounded-sm px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-white"
                  style={{
                    left: caretPos.x + 3,
                    top: caretPos.y - 16 < 0 ? caretPos.y + lineHeight : caretPos.y - 16,
                    backgroundColor: color,
                  }}
                >
                  {name}
                </div>
              </>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
