"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Search, X } from "lucide-react"

import { FOCUS_PAGE_SEARCH_EVENT } from "./app-shell-events"
import styles from "./app-shell-features.module.css"

const CONTENT_SELECTOR = "#main-content"
const MARK_CLASS = styles.mark

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
 */
function applyHighlights(root: HTMLElement, query: string): number {
  clearHighlights(root)
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isSkippableTextNode(node as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  let count = 0
  for (const node of textNodes) {
    const text = node.nodeValue ?? ""
    const lower = text.toLowerCase()
    let index = lower.indexOf(needle)
    if (index === -1) continue

    const fragment = document.createDocumentFragment()
    let last = 0
    while (index !== -1) {
      if (index > last) fragment.appendChild(document.createTextNode(text.slice(last, index)))
      const mark = document.createElement("mark")
      mark.className = MARK_CLASS
      mark.textContent = text.slice(index, index + needle.length)
      fragment.appendChild(mark)
      count += 1
      last = index + needle.length
      index = lower.indexOf(needle, last)
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
  const inputRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()
  /** True while applyHighlights is mutating the DOM, so the MutationObserver
      below ignores our own <mark> injections instead of re-running forever. */
  const applyingRef = useRef(false)

  const refresh = useCallback(() => {
    const root = document.querySelector<HTMLElement>(CONTENT_SELECTOR)
    if (!root) {
      setMatchCount(0)
      return
    }
    applyingRef.current = true
    try {
      setMatchCount(applyHighlights(root, query))
    } finally {
      // MutationObserver callbacks run as a microtask after this synchronous
      // block, so clearing the flag here still suppresses our own batch.
      queueMicrotask(() => {
        applyingRef.current = false
      })
    }
  }, [query])

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
      document
        .querySelector(`#main-content mark.${MARK_CLASS}`)
        ?.scrollIntoView({ block: "center" })
    }
  }

  const trimmed = query.trim()

  return (
    <div className={styles.pageSearch}>
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
  )
}
