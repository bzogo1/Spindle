"use client"

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react"
import type { FocusEvent, KeyboardEvent } from "react"
import { useRouter } from "next/navigation"

import { DOC_GUIDE_SUMMARIES, searchDocs, tokenizeQuery } from "@/lib/docs-search"
import {
  readQueryLog,
  recordSearchQuery,
  searchSuggestions,
  type QueryLogEntry,
} from "@/lib/search/suggestions"
import type { SearchItem } from "@/lib/search"

type SearchOption = {
  targetId: string
  guideTitle: string
  title: string
  description?: string
  snippet?: string
  href: string
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** How many previous searches the history section shows. */
const HISTORY_LIMIT = 8

/**
 * Short timestamp for a history row: time-of-day for today's searches,
 * otherwise a compact date + time.
 */
function formatHistoryTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return date.toLocaleString(undefined, {
    ...(sameDay
      ? {}
      : {
          month: "short" as const,
          day: "numeric" as const,
          ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
        }),
    hour: "numeric" as const,
    minute: "2-digit" as const,
  })
}

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return <>{text}</>

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi")
  const lowerTokens = new Set(tokens)

  return (
    <>
      {text
        .split(pattern)
        .map((part, index) =>
          lowerTokens.has(part.toLowerCase()) ? (
            <mark key={index}>{part}</mark>
          ) : (
            <Fragment key={index}>{part}</Fragment>
          ),
        )}
    </>
  )
}

/**
 * Client-side docs search. The index is imported at build time, so typing never
 * triggers a request; the query only reaches this tab (and the URL bar).
 */
export function DocsSearch({
  onNavigate,
  anchorId,
}: {
  onNavigate?: () => void
  /** Element id, only for the docs index the hero search link targets. */
  anchorId?: string
} = {}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const baseId = useId()
  const inputId = `${baseId}-input`
  const hintId = `${baseId}-hint`
  const listId = `${baseId}-listbox`
  const statusId = `${baseId}-status`
  const optionId = (index: number) => `${listId}-option-${index}`

  const trimmed = query.trim()
  const results = useMemo(() => searchDocs(query), [query])

  const options: SearchOption[] = useMemo(() => {
    if (!trimmed) {
      return DOC_GUIDE_SUMMARIES.map((guide) => ({
        targetId: guide.id,
        guideTitle: guide.title,
        title: guide.title,
        description: guide.description,
        href: `/docs/${guide.id}`,
      }))
    }

    return results.map((result) => ({
      targetId: result.sectionId,
      guideTitle: result.guideTitle,
      title: result.sectionTitle,
      snippet: result.snippet,
      href: result.href,
    }))
  }, [results, trimmed])

  const listOpen = open && options.length > 0
  const hasResults = trimmed.length === 0 || results.length > 0

  // Previous searches from the local query log (localStorage). Re-read while
  // the dropdown is open with an empty query so a freshly recorded search
  // shows up; historyVersion is bumped after selectHistory().
  const [historyVersion, setHistoryVersion] = useState(0)
  const history = useMemo<QueryLogEntry[]>(() => {
    if (!open || trimmed) return []
    return readQueryLog().slice(0, HISTORY_LIMIT)
    // historyVersion intentionally re-reads the log after a history pick.
  }, [open, trimmed, historyVersion])
  const showHistory = listOpen && history.length > 0

  const closestGuides = useMemo(() => {
    const tokens = tokenizeQuery(trimmed)
    if (tokens.length === 0) return DOC_GUIDE_SUMMARIES.slice(0, 3)

    return DOC_GUIDE_SUMMARIES.map((guide) => {
      const haystack = `${guide.title} ${guide.description}`.toLowerCase()
      return {
        guide,
        score: tokens.filter((token) => haystack.includes(token)).length,
      }
    })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.guide)
  }, [trimmed])

  // "Did you mean" spelling corrections derived from guide titles — only
  // computed while the empty state is visible.
  const suggestionItems = useMemo<SearchItem[]>(
    () =>
      DOC_GUIDE_SUMMARIES.map((guide) => ({
        id: `doc-guide:${guide.id}`,
        title: guide.title,
        subtitle: guide.description,
        group: "Docs",
        type: "doc",
        section: "Guides",
      })),
    [],
  )
  const didYouMean = useMemo(
    () =>
      open && trimmed && !hasResults
        ? searchSuggestions(trimmed, { items: suggestionItems }).didYouMean
        : [],
    [open, trimmed, hasResults, suggestionItems],
  )

  // Read ?q= after hydration so the static HTML stays identical.
  useEffect(() => {
    const url = new URL(window.location.href)
    const initial = url.searchParams.get("q") ?? ""
    if (initial) {
      setQuery(initial)
      setOpen(true)
    }
    setHydrated(true)
  }, [])

  // Keep shareable state in the URL without adding history entries.
  useEffect(() => {
    if (!hydrated) return

    const url = new URL(window.location.href)
    if (trimmed) url.searchParams.set("q", trimmed)
    else url.searchParams.delete("q")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }, [hydrated, trimmed])

  // The docs hero links here; focus the field when that anchor is followed.
  useEffect(() => {
    if (!anchorId) return

    const focus = () => {
      if (window.location.hash === `#${anchorId}`) inputRef.current?.focus()
    }
    focus()
    window.addEventListener("hashchange", focus)
    return () => window.removeEventListener("hashchange", focus)
  }, [anchorId])

  useEffect(() => {
    setActive(0)
  }, [trimmed])

  const status = trimmed
    ? results.length > 0
      ? `${results.length} ${results.length === 1 ? "result" : "results"} for ${trimmed}`
      : `No results for ${trimmed}`
    : `${DOC_GUIDE_SUMMARIES.length} guides`

  function selectOption(option: SearchOption) {
    setOpen(false)
    // Feed the local query log so trending/related suggestions learn from
    // real usage. Local only — nothing leaves the browser.
    recordSearchQuery(query)

    const sectionId = option.href.split("#")[1]
    const target = sectionId ? document.getElementById(sectionId) : null

    if (target && sectionId) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      })
      target.focus({ preventScroll: true })

      const url = new URL(window.location.href)
      url.hash = sectionId
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      )
      onNavigate?.()
      return
    }

    onNavigate?.()
    router.push(option.href)
  }

  /** Fill the input with a previous search from the history section. */
  function selectHistory(entry: QueryLogEntry) {
    recordSearchQuery(entry.query)
    setQuery(entry.query)
    setOpen(true)
    setHistoryVersion((version) => version + 1)
    inputRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((current) => (open ? Math.min(options.length - 1, current + 1) : 0))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActive((current) => (open ? Math.max(0, current - 1) : Math.max(0, options.length - 1)))
      return
    }

    if (event.key === "Enter" && listOpen) {
      const option = options[active]
      if (option) {
        event.preventDefault()
        selectOption(option)
      }
      return
    }

    if (event.key === "Escape") {
      setOpen(false)
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
    }
  }

  return (
    <div className="doc-search" id={anchorId} role="search" onBlur={handleBlur}>
      <label className="doc-search-label" htmlFor={inputId}>
        Search the docs
      </label>
      <div className="doc-search-field">
        <svg className="icon icon--sm" aria-hidden="true">
          <use href="#i-search" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          value={query}
          placeholder="Search guides…"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={listOpen ? optionId(active) : undefined}
          aria-describedby={`${hintId} ${statusId}`}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="doc-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            <svg className="icon icon--xs" aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        ) : null}
      </div>
      <p className="doc-search-hint" id={hintId}>
        Searches stay in this tab — nothing is sent to a server.
      </p>

      <p className="sr-only" id={statusId} role="status" aria-live="polite">
        {status}
      </p>

      {listOpen ? (
        <div className="doc-search-results">
          {showHistory ? (
            <div
              className="doc-search-history"
              ref={historyRef}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  setOpen(false)
                  inputRef.current?.focus()
                }
              }}
            >
              <div className="doc-search-history-label">Recent searches</div>
              {history.map((entry) => (
                <button
                  key={entry.query}
                  type="button"
                  className="doc-search-history-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectHistory(entry)}
                >
                  <span className="doc-search-history-query">{entry.query}</span>
                  <time
                    className="doc-search-history-time"
                    dateTime={new Date(entry.lastUsed).toISOString()}
                  >
                    {formatHistoryTime(entry.lastUsed)}
                  </time>
                </button>
              ))}
            </div>
          ) : null}
          <div role="listbox" id={listId} aria-label="Docs search results">
            {options.map((option, index) => (
              <div
                key={`${option.href}-${index}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={`doc-search-option${index === active ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => selectOption(option)}
              >
                <span className="doc-search-option-title">
                  {option.guideTitle !== option.title ? (
                    <span className="doc-search-option-guide">{option.guideTitle}</span>
                  ) : null}
                  {option.title}
                </span>
                <span className="doc-search-option-snippet">
                  {option.snippet ? (
                    <Highlight text={option.snippet} query={trimmed} />
                  ) : (
                    option.description
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {open && !hasResults ? (
        <div className="doc-search-empty" role="status">
          <p>
            No matches for <strong>{trimmed}</strong>.
          </p>
          {didYouMean.length > 0 ? (
            <p className="doc-search-didyoumean">
              Did you mean:{" "}
              {didYouMean.map((suggestion, index) => (
                <span key={suggestion.suggestion}>
                  {index > 0 ? ", " : ""}
                  <button
                    type="button"
                    className="doc-search-didyoumean-link"
                    onClick={() => {
                      setQuery(suggestion.suggestion)
                      setOpen(true)
                      inputRef.current?.focus()
                    }}
                  >
                    {suggestion.suggestion}
                  </button>
                </span>
              ))}
              ?
            </p>
          ) : null}
          <p>Try one of these guides instead:</p>
          <div className="doc-search-empty-links">
            {closestGuides.map((guide) => (
              <a key={guide.id} href={`/docs/${guide.id}`} onClick={() => setOpen(false)}>
                {guide.title}
              </a>
            ))}
          </div>
          <button
            type="button"
            className="doc-search-reset"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            Reset search
          </button>
        </div>
      ) : null}
    </div>
  )
}
