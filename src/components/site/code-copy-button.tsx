"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type CopyStatus = "idle" | "copied" | "error"

const RESET_DELAY = 2000

function legacyCopy(text: string) {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)

  try {
    textarea.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

function selectCode(button: HTMLButtonElement | null) {
  const block = button?.closest("[data-code-block]")
  const code = block?.querySelector("pre code")
  if (!code || typeof window === "undefined") return

  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(code)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function CodeCopyButton({ code, label }: { code: string; label?: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  const buttonRef = useRef<HTMLButtonElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(async () => {
    let copied = false

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(code)
        copied = true
      } catch {
        copied = false
      }
    }

    // Non-secure contexts and older browsers have no clipboard API.
    if (!copied) copied = legacyCopy(code)

    if (!copied) selectCode(buttonRef.current)

    setStatus(copied ? "copied" : "error")

    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setStatus("idle"), RESET_DELAY)
  }, [code])

  useEffect(() => {
    const block = buttonRef.current?.closest<HTMLElement>("[data-code-block]")
    if (!block) return

    function onKeyDown(event: KeyboardEvent) {
      const isCopyShortcut =
        (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "c"
      if (!isCopyShortcut) return

      event.preventDefault()
      void copy()
    }

    block.addEventListener("keydown", onKeyDown)
    return () => block.removeEventListener("keydown", onKeyDown)
  }, [copy])

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const accessibleLabel = label ? `Copy ${label} code` : "Copy code"

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="code-copy"
        data-status={status}
        aria-label={accessibleLabel}
        aria-keyshortcuts="Control+Shift+C Meta+Shift+C"
        title="Copy code (Ctrl/Cmd+Shift+C)"
        onClick={() => void copy()}
      >
        <svg className="icon icon--xs" aria-hidden="true">
          <use href={status === "copied" ? "#i-check" : "#i-copy"} />
        </svg>
        <span>{status === "copied" ? "Copied" : status === "error" ? "Copy failed" : "Copy"}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "copied"
          ? `${label ?? "Code"} copied to clipboard.`
          : status === "error"
            ? "Copy failed. The code is selected so you can copy it manually."
            : ""}
      </span>
    </>
  )
}
