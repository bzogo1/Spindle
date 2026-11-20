"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ClipboardCopy } from "lucide-react"

type CopyStatus = "idle" | "copied" | "error"

const RESET_DELAY = 2000

export interface CopyButtonProps {
  /** Text written to the clipboard — a string, or a factory evaluated on click. */
  text: string | (() => string)
  /** Idle label shown on the button (e.g. "Copy ID"). */
  label?: string
  className?: string
}

/**
 * Small inline copy-to-clipboard button for app screens. Shows a transient
 * "Copied"/"Copy failed" state and announces the result via a polite
 * `role="status"` live region for screen readers.
 */
export function CopyButton({ text, label = "Copy", className }: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const copy = async () => {
    const value = typeof text === "function" ? text() : text
    let copied = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value)
        copied = true
      } catch {
        copied = false
      }
    }
    setStatus(copied ? "copied" : "error")
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setStatus("idle"), RESET_DELAY)
  }

  return (
    <>
      <button
        type="button"
        className={["fm-btn", "app-copy-btn", className].filter(Boolean).join(" ")}
        onClick={() => void copy()}
      >
        {status === "copied" ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
        {status === "copied" ? "Copied" : status === "error" ? "Copy failed" : label}
      </button>
      {/* Plain aria-live region (not role="status") so pages that already
          expose a single status role — e.g. approval decision notes — keep
          exactly one match for assistive tech and tests. */}
      <span className="sr-only" aria-live="polite">
        {status === "copied"
          ? `${label} copied to clipboard.`
          : status === "error"
            ? `Couldn't copy ${label.toLowerCase()}.`
            : ""}
      </span>
    </>
  )
}
