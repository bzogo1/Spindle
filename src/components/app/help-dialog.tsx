"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BookOpen, CircleHelp, Keyboard, LifeBuoy, Search } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { searchDocs } from "@/lib/docs-search"

import { OPEN_SHORTCUTS_EVENT } from "./app-shell-events"
import styles from "./app-shell-features.module.css"

/**
 * Top-bar "Help" button + dialog. Searches the static docs index
 * (src/lib/docs-search) entirely client-side and offers quick links to the
 * docs, help center, and support, plus a shortcut into the keyboard-shortcuts
 * dialog owned by KeyboardShortcuts.
 */
export function HelpDialog() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const results = useMemo(() => (query.trim() ? searchDocs(query) : []), [query])
  const trimmed = query.trim()

  function openShortcuts() {
    setOpen(false)
    window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setQuery("")
  }

  return (
    <>
      <button
        type="button"
        className="app-icon-button"
        onClick={() => handleOpenChange(true)}
        aria-label="Help and documentation"
        title="Help"
      >
        <CircleHelp aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="app-help-dialog">
          <DialogHeader>
            <DialogTitle className="app-shortcuts-title">
              <CircleHelp aria-hidden="true" />
              Help &amp; documentation
            </DialogTitle>
            <DialogDescription>Search the docs or jump to a help resource.</DialogDescription>
          </DialogHeader>

          <div className={styles.helpSearch} role="search">
            <Search className={styles.helpSearchIcon} aria-hidden="true" />
            <input
              type="search"
              className={styles.helpSearchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation…"
              aria-label="Search documentation"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>

          <p className={styles.helpStatus} role="status" aria-live="polite">
            {trimmed
              ? results.length === 0
                ? `No docs match “${trimmed}”.`
                : `${results.length} ${results.length === 1 ? "result" : "results"} for “${trimmed}”.`
              : "Type to search guides, or browse the links below."}
          </p>

          {results.length > 0 ? (
            <ul className={styles.helpResults}>
              {results.map((result) => (
                <li key={`${result.guideId}:${result.sectionId}`}>
                  <Link
                    href={result.href}
                    className={styles.helpResult}
                    onClick={() => setOpen(false)}
                  >
                    <span className={styles.helpResultTitle}>
                      {result.titleMatch ? result.sectionTitle : result.guideTitle}
                      <span className={styles.helpResultMeta}> · {result.guideTitle}</span>
                    </span>
                    <span className={styles.helpResultSnippet}>{result.snippet}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className={styles.helpLinks}>
            <Link href="/docs" className={styles.helpLink} onClick={() => setOpen(false)}>
              <BookOpen aria-hidden="true" />
              Documentation
            </Link>
            <Link href="/help" className={styles.helpLink} onClick={() => setOpen(false)}>
              <LifeBuoy aria-hidden="true" />
              Help center
            </Link>
            <Link href="/contact" className={styles.helpLink} onClick={() => setOpen(false)}>
              Contact support
            </Link>
            <button type="button" className={styles.helpLink} onClick={openShortcuts}>
              <Keyboard aria-hidden="true" />
              Keyboard shortcuts
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
