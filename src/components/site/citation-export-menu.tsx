"use client"

import { useEffect, useId, useRef, useState } from "react"

import {
  CITATION_FORMATS,
  downloadCitations,
  type CitationFormat,
  type CitationItem,
} from "@/lib/citation-export"

import styles from "./citation-export-menu.module.css"

/**
 * "Export citations" dropdown. Renders a trigger button that opens a small
 * menu with one entry per citation format (BibTeX / RIS / CSV); selecting an
 * entry serializes `items` and downloads the file client-side.
 *
 * Disabled automatically when there is nothing to export. Closes on
 * outside click, Escape, or after a successful selection.
 */
export function CitationExportMenu({
  items,
  fileName = "citations",
  disabled = false,
  className,
}: {
  items: readonly CitationItem[]
  /** Base name for the downloaded file (extension is added per format). */
  fileName?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const isDisabled = disabled || items.length === 0

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  function selectFormat(format: CitationFormat) {
    setOpen(false)
    downloadCitations(format, items, { fileName })
  }

  return (
    <div className={`${styles.root} ${className ?? ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={
          items.length > 0
            ? `Export ${items.length} ${items.length === 1 ? "result" : "results"} as a citation`
            : "Export citations"
        }
        disabled={isDisabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Export citations</span>
        <svg className="icon icon--xs" aria-hidden="true">
          <use href="#i-chevron-down" />
        </svg>
      </button>

      {open ? (
        <div className={styles.menu} id={menuId} role="menu" aria-label="Citation formats">
          {CITATION_FORMATS.map((format) => (
            <button
              key={format.key}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => selectFormat(format.key)}
            >
              {format.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
