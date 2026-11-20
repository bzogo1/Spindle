"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { CollaborativeDocument } from "@/lib/collab/document"
import type { CollabClient } from "@/lib/collab/sync"
import type { OfflineOpQueue } from "@/lib/collab/offline"
import { Textarea } from "@/components/ui/textarea"

export interface CollaborativeEditorProps {
  /** Shared document model (CRDT-backed). */
  document: CollaborativeDocument
  /** Optional live sync client; local ops are broadcast through it. */
  client?: CollabClient | null
  /** Optional offline queue; local ops are persisted until flushed. */
  offlineQueue?: OfflineOpQueue | null
  className?: string
  placeholder?: string
  disabled?: boolean
  /** Reports selection/caret changes (visible character indices). */
  onSelectionChange?: (sel: { start: number; end: number }) => void
  /** Reports user activity (typing, caret moves) for idle detection. */
  onActivity?: () => void
}

/**
 * Textarea-backed collaborative editor.
 *
 * Local edits are diffed into CRDT ops (delete + insert) and applied to the
 * document immediately; ops are broadcast via `client` and/or queued in
 * `offlineQueue`. Remote ops re-render the textarea with best-effort caret
 * preservation (common-prefix/suffix heuristic).
 */
export function CollaborativeEditor({
  document,
  client = null,
  offlineQueue = null,
  className,
  placeholder,
  disabled,
  onSelectionChange,
  onActivity,
}: CollaborativeEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [text, setText] = React.useState(() => document.text)
  // Pending local diff state, kept in refs to avoid stale closures.
  const prevTextRef = React.useRef(document.text)
  const selectionRef = React.useRef({ start: document.text.length, end: document.text.length })
  const applyingRemoteRef = React.useRef(false)
  // Set while a local edit is being applied — document.subscribe fires
  // synchronously for local ops too, and must not treat them as remote.
  const localEditRef = React.useRef(false)

  // Broadcast locally-generated ops; queue them when offline so they can be
  // flushed on reconnect (CRDT ops are idempotent, so re-delivery is safe).
  React.useEffect(() => {
    return document.onLocalOps((ops) => {
      if (client?.connected) client.sendOps(ops)
      if (offlineQueue && !client?.connected) void offlineQueue.push(...ops)
    })
  }, [document, client, offlineQueue])

  // Re-render on remote changes with caret preservation.
  React.useEffect(() => {
    return document.subscribe(() => {
      // Local edits are already reflected in `text`/`prevTextRef` — skip.
      if (localEditRef.current) return
      const next = document.text
      const prev = prevTextRef.current
      if (next === prev) return
      prevTextRef.current = next

      const { start, end } = selectionRef.current
      const { caretStart, caretEnd } = adjustCaret(prev, next, start, end)

      applyingRemoteRef.current = true
      setText(next)
      // Release the guard in a microtask — long before the next frame or
      // user input event — so a real keystroke in the same frame is not
      // swallowed. The rAF below only restores the caret.
      queueMicrotask(() => {
        applyingRemoteRef.current = false
      })
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.setSelectionRange(caretStart, caretEnd)
          selectionRef.current = { start: caretStart, end: caretEnd }
        }
      })
    })
  }, [document])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (applyingRemoteRef.current) return
    const next = e.target.value
    const prev = prevTextRef.current

    // Diff prev -> next: longest common prefix + suffix.
    let p = 0
    const maxP = Math.min(prev.length, next.length)
    while (p < maxP && prev[p] === next[p]) p++
    let s = 0
    while (
      s < Math.min(prev.length - p, next.length - p) &&
      prev[prev.length - 1 - s] === next[next.length - 1 - s]
    )
      s++

    const delStart = p
    const delEnd = prev.length - s
    const inserted = next.slice(p, next.length - s)

    // Ops are computed against the *pre-edit* document positions. Flag the
    // edit so the synchronous subscribe callback ignores it, and update
    // prevTextRef first so even an unflagged path sees no diff.
    prevTextRef.current = next
    localEditRef.current = true
    try {
      document.replaceRange(delStart, delEnd, inserted)
    } finally {
      localEditRef.current = false
    }

    setText(next)
    const caret = p + inserted.length
    selectionRef.current = {
      start: e.target.selectionStart ?? caret,
      end: e.target.selectionEnd ?? caret,
    }
    onSelectionChange?.(selectionRef.current)
    onActivity?.()
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const sel = {
      start: e.currentTarget.selectionStart,
      end: e.currentTarget.selectionEnd,
    }
    selectionRef.current = sel
    onSelectionChange?.(sel)
    onActivity?.()
  }

  return (
    <Textarea
      ref={textareaRef}
      value={text}
      onChange={handleChange}
      onSelect={handleSelect}
      onKeyUp={handleSelect}
      onClick={handleSelect}
      placeholder={placeholder}
      disabled={disabled}
      className={cn("font-mono text-sm leading-relaxed", className)}
    />
  )
}

/**
 * Best-effort caret mapping across a remote edit: if the caret sits inside
 * the replaced region it clamps to the region's end; otherwise it shifts by
 * the length delta of the change before it.
 */
function adjustCaret(
  prev: string,
  next: string,
  start: number,
  end: number,
): { caretStart: number; caretEnd: number } {
  let p = 0
  const maxP = Math.min(prev.length, next.length)
  while (p < maxP && prev[p] === next[p]) p++
  let s = 0
  while (
    s < Math.min(prev.length - p, next.length - p) &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  )
    s++
  const delEnd = prev.length - s
  const insEnd = next.length - s
  const delta = insEnd - delEnd

  const map = (pos: number) => {
    if (pos <= p) return pos
    if (pos >= delEnd) return pos + delta
    return insEnd // inside the replaced region → clamp to its end
  }
  const cs = Math.max(0, Math.min(next.length, map(start)))
  const ce = Math.max(cs, Math.min(next.length, map(end)))
  return { caretStart: cs, caretEnd: ce }
}
