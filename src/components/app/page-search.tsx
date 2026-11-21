"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { BookmarkPlus, Check, Search, X } from "lucide-react"

import { FOCUS_PAGE_SEARCH_EVENT } from "./app-shell-events"
import styles from "./app-shell-features.module.css"

const CONTENT_SELECTOR = "#main-content"
const MARK_CLASS = styles.mark
const ACTIVE_MARK_CLASS = styles.markActive
const MODE_STORAGE_KEY = "spindle.app.page-search-mode:v1"

export type SearchMode = "basic" | "academic"

/** localStorage key for the saved-search history (most recent first). */
export const SEARCH_HISTORY_KEY = "spindle-search-history"
const SEARCH_HISTORY_LIMIT = 20

function readSearchHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === "string")
  } catch {
    return []
  }
}

/** Persist `query` at the front of the search history, deduped (case-insensitive). */
function pushSearchHistory(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return
  const lower = trimmed.toLowerCase()
  const history = [
    trimmed,
    ...readSearchHistory().filter((entry) => entry.toLowerCase() !== lower),
  ].slice(0, SEARCH_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // Storage full/unavailable — saving is best-effort.
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isSkippableTextNode(node: Text) {
  const parent = node.parentElement
  if (!parent) return true
  return Boolean(parent.closest("script, style, noscript, template"))
}

/** Remove every highlight <mark> previously injected into the content root. */
function clearHighlights(root: HTMLElement) {
  root.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

/**
 * Wrap every case-insensitive occurrence of `query` inside `root` in a
 * <mark> element. Text nodes are collected before mutation so replacing them
 * cannot disturb the walk. Returns the number of matches.
 *
 * `wholeWord` (Academic mode) restricts matches to whole words/phrases —
 * the needle must not be flanked by letters, numbers, or underscores.
 * Basic mode keeps the original substring behaviour.
 */
function applyHighlights(root: HTMLElement, query: string, wholeWord = false): number {
  clearHighlights(root)
  const needle = query.trim()
  if (!needle) return 0

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isSkippableTextNode(node as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  const wordPattern = wholeWord
    ? new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`,
        "giu",
      )
    : null
  const lowerNeedle = needle.toLowerCase()

  let count = 0
  for (const node of textNodes) {
    const text = node.nodeValue ?? ""
    const ranges: [number, number][] = []

    if (wordPattern) {
      wordPattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = wordPattern.exec(text)) !== null) {
        ranges.push([match.index, match.index + match[0].length])
        if (match[0].length === 0) wordPattern.lastIndex += 1
      }
    } else {
      const lower = text.toLowerCase()
      let index = lower.indexOf(lowerNeedle)
      while (index !== -1) {
        ranges.push([index, index + lowerNeedle.length])
        index = lower.indexOf(lowerNeedle, index + lowerNeedle.length)
      }
    }
    if (ranges.length === 0) continue

    const fragment = document.createDocumentFragment()
    let last = 0
    for (const [start, end] of ranges) {
      if (start > last) fragment.appendChild(document.createTextNode(text.slice(last, start)))
      const mark = document.createElement("mark")
      mark.className = MARK_CLASS
      mark.textContent = text.slice(start, end)
      fragment.appendChild(mark)
      count += 1
      last = end
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(fragment, node)
  }
  return count
}

/**
 * "Search in page" box for the top bar. Filters the current page's content by
 * highlighting every match inside #main-content (client-side, no server
 * round-trip) and reporting the match count. "/" focuses the input (dispatched
 * by KeyboardShortcuts), Enter jumps to the first match, Escape clears.
 */
export function PageSearch() {
  const [query, setQuery] = useState("")
  const [matchCount, setMatchCount] = useState(0)
  const [mode, setMode] = useState<SearchMode>("basic")
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()
  /** Index of the currently active <mark> when cycling with Enter in
      Academic mode; -1 means none. Reset whenever matches are rebuilt. */
  const activeIndexRef = useRef(-1)
  /** True while applyHighlights is mutating the DOM, so the MutationObserver
      below ignores our own <mark> injections instead of re-running forever. */
  const applyingRef = useRef(false)

  // Restore the persisted mode after mount (localStorage is client-only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MODE_STORAGE_KEY)
      if (raw === "basic" || raw === "academic") setMode(raw)
    } catch {
      // Storage unavailable (private mode) — keep the default.
    }
  }, [])

  function toggleMode() {
    setMode((previous) => {
      const next: SearchMode = previous === "academic" ? "basic" : "academic"
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, next)
      } catch {
        // Storage unavailable; the mode still applies for this session.
      }
      return next
    })
  }

  const refresh = useCallback(() => {
    const root = document.querySelector<HTMLElement>(CONTENT_SELECTOR)
    activeIndexRef.current = -1
    root
      ?.querySelectorAll(`mark.${ACTIVE_MARK_CLASS}`)
      .forEach((mark) => mark.classList.remove(ACTIVE_MARK_CLASS))
    if (!root) {
      setMatchCount(0)
      return
    }
    applyingRef.current = true
    try {
      setMatchCount(applyHighlights(root, query, mode === "academic"))
    } finally {
      // MutationObserver callbacks run as a microtask after this synchronous
      // block, so clearing the flag here still suppresses our own batch.
      queueMicrotask(() => {
        applyingRef.current = false
      })
    }
  }, [query, mode])

  // Re-highlight on query and route changes; clear marks on unmount.
  useEffect(() => {
    refresh()
    return () => {
      const root = document.querySelector<HTMLElement>(CONTENT_SELECTOR)
      if (root) clearHighlights(root)
    }
  }, [refresh, pathname])

  // Content renders asynchronously (data fetching, lazy chunks), so watch
  // #main-content and re-apply while a query is active.
  useEffect(() => {
    if (!query.trim()) return
    const root = document.querySelector<HTMLElement>(CONTENT_SELECTOR)
    if (!root || typeof MutationObserver === "undefined") return

    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      if (applyingRef.current) return
      clearTimeout(timer)
      timer = setTimeout(refresh, 150)
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [query, refresh, pathname])

  // "/" shortcut: KeyboardShortcuts dispatches FOCUS_PAGE_SEARCH_EVENT.
  useEffect(() => {
    function onFocusRequest() {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener(FOCUS_PAGE_SEARCH_EVENT, onFocusRequest)
    return () => window.removeEventListener(FOCUS_PAGE_SEARCH_EVENT, onFocusRequest)
  }, [])

  function saveSearch() {
    const trimmed = query.trim()
    if (!trimmed) return
    pushSearchHistory(trimmed)
    setSaved(true)
    clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
  }

  // Clear the "saved" timer on unmount.
  useEffect(() => () => clearTimeout(savedTimerRef.current), [])

  function clear() {
    setQuery("")
    inputRef.current?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setQuery("")
      inputRef.current?.blur()
    } else if (event.key === "Enter" && matchCount > 0) {
      event.preventDefault()
      const marks = document.querySelectorAll<HTMLElement>(
        `#main-content mark.${MARK_CLASS}`,
      )
      if (marks.length === 0) return
      if (mode === "academic") {
        // Academic mode cycles through matches, marking the active one.
        activeIndexRef.current = (activeIndexRef.current + 1) % marks.length
        document
          .querySelectorAll(`mark.${ACTIVE_MARK_CLASS}`)
          .forEach((mark) => mark.classList.remove(ACTIVE_MARK_CLASS))
        const active = marks[activeIndexRef.current]
        active.classList.add(ACTIVE_MARK_CLASS)
        active.scrollIntoView({ block: "center" })
      } else {
        marks[0].scrollIntoView({ block: "center" })
      }
    }
  }

  const trimmed = query.trim()

  return (
    <div className={styles.pageSearch}>
      <div className={styles.pageSearchBox}>
        <Search className={styles.pageSearchIcon} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className={styles.pageSearchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search this page"
          aria-label="Search this page"
          aria-describedby="app-page-search-count"
          autoComplete="off"
          spellCheck={false}
        />
        {trimmed ? (
          <button
            type="button"
            className={`${styles.pageSearchSave}${saved ? ` ${styles.pageSearchSaveActive}` : ""}`}
            onClick={saveSearch}
            aria-label={saved ? "Search saved" : "Save search"}
            title={saved ? "Saved to search history" : "Save search to history"}
          >
            {saved ? <Check aria-hidden="true" /> : <BookmarkPlus aria-hidden="true" />}
          </button>
        ) : null}
        {trimmed ? (
          <button
            type="button"
            className={styles.pageSearchClear}
            onClick={clear}
            aria-label="Clear page search"
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
        {trimmed ? (
          <span
            id="app-page-search-count"
            className={styles.matchCount}
            role="status"
            aria-live="polite"
          >
            {matchCount === 0
              ? "No matches"
              : `${matchCount} ${matchCount === 1 ? "match" : "matches"}`}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className={styles.pageSearchMode}
        onClick={toggleMode}
        aria-pressed={mode === "academic"}
        title={
          mode === "academic"
            ? "Academic mode: whole-word matches, Enter cycles results"
            : "Basic mode: substring matches, Enter jumps to first result"
        }
      >
        {mode === "academic" ? "Academic" : "Basic"}
      </button>
    </div>
  )
}
