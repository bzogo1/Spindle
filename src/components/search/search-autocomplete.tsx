"use client"

import { useId, useMemo, useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"

import { SearchHighlight } from "./highlight"
import styles from "./search-ui.module.css"

/**
 * One selectable row in the typeahead dropdown. `group` controls which
 * section heading the row renders under; entries are expected pre-sorted.
 */
export type AutocompleteEntry = {
  id: string
  title: string
  subtitle?: string
  /** Extra match text considered for highlighting (not necessarily displayed). */
  keywords?: string
  /** Group label, e.g. "Pages" vs "Docs". Defaults to "Results". */
  group?: string
  href?: string
  /** Alternative activation hook when the consumer doesn't navigate. */
  onSelect?: () => void
}

export type AutocompleteSuggestions = {
  /** Spelling corrections — strings or `{ suggestion }` objects. */
  didYouMean?: ReadonlyArray<string | { suggestion: string }>
  related?: readonly string[]
  trending?: readonly string[]
}

export type SearchAutocompleteProps = {
  /** Controlled input value. */
  query: string
  onQueryChange: (query: string) => void
  /** Ranked entries to suggest (already filtered/scored by the caller). */
  items: AutocompleteEntry[]
  /** Preferred group order; unlisted groups append alphabetically. */
  groupOrder?: readonly string[]
  /** Called when an entry is activated via click or Enter. */
  onSelect: (entry: AutocompleteEntry) => void
  /** "Did you mean" / related / trending chips rendered under the list. */
  suggestions?: AutocompleteSuggestions
  /** Called when a suggestion chip is chosen — typically sets the query. */
  onSuggestionSelect?: (query: string) => void
  placeholder?: string
  ariaLabel?: string
  /** Max entries rendered before truncating. Default 8. */
  maxItems?: number
  /** Rendered inside the dropdown when `items` is empty and a query exists. */
  emptyMessage?: ReactNode
  /** Escape key / explicit close request. */
  onRequestClose?: () => void
  disabled?: boolean
  id?: string
  className?: string
}

type EntryGroup = { label: string; items: AutocompleteEntry[] }

function suggestionText(entry: string | { suggestion: string }): string {
  return typeof entry === "string" ? entry : entry.suggestion
}

/**
 * Typeahead dropdown with keyboard navigation (ArrowUp/ArrowDown/Enter/
 * Escape), highlighted query matches, and grouped suggestions (e.g. Pages vs
 * Docs). Fully controlled — the caller owns the query and the item list
 * (typically produced by `useSearchIndex`).
 */
export function SearchAutocomplete({
  query,
  onQueryChange,
  items,
  groupOrder,
  onSelect,
  suggestions,
  onSuggestionSelect,
  placeholder = "Search…",
  ariaLabel = "Search",
  maxItems = 8,
  emptyMessage,
  onRequestClose,
  disabled = false,
  id,
  className,
}: SearchAutocompleteProps) {
  const baseId = useId()
  const inputId = id ?? `${baseId}-input`
  const listId = `${baseId}-listbox`
  const statusId = `${baseId}-status`
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const trimmed = query.trim()

  // Group entries preserving score order within each group.
  const groups = useMemo<EntryGroup[]>(() => {
    const visible = items.slice(0, maxItems)
    const byLabel = new Map<string, AutocompleteEntry[]>()
    for (const entry of visible) {
      const label = entry.group ?? "Results"
      const bucket = byLabel.get(label)
      if (bucket) bucket.push(entry)
      else byLabel.set(label, [entry])
    }
    const order = groupOrder ?? []
    const labels = [...byLabel.keys()].sort((a, b) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai !== -1 || bi !== -1)
        return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi)
      return a.localeCompare(b)
    })
    return labels.map((label) => ({ label, items: byLabel.get(label)! }))
  }, [items, groupOrder, maxItems])

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

  const didYouMean = useMemo(
    () => (suggestions?.didYouMean ?? []).map(suggestionText).filter(Boolean),
    [suggestions?.didYouMean],
  )
  const related = suggestions?.related ?? []
  const trending = suggestions?.trending ?? []
  const hasDidYouMean = trimmed.length > 0 && didYouMean.length > 0
  const hasRelated = trimmed.length > 0 && related.length > 0
  const hasTrending = trimmed.length === 0 && trending.length > 0
  const hasChips = hasDidYouMean || hasRelated || hasTrending

  const listOpen =
    open &&
    !disabled &&
    (flatItems.length > 0 || hasChips || (trimmed.length > 0 && emptyMessage != null))

  function activate(entry: AutocompleteEntry | undefined) {
    if (!entry) return
    setOpen(false)
    entry.onSelect?.()
    onSelect(entry)
  }

  function applySuggestion(text: string) {
    setOpen(false)
    onQueryChange(text)
    onSuggestionSelect?.(text)
    inputRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.min(flatItems.length - 1, current + 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => Math.max(0, current - 1))
      return
    }
    if (event.key === "Enter") {
      if (listOpen && flatItems.length > 0) {
        event.preventDefault()
        activate(flatItems[Math.min(activeIndex, flatItems.length - 1)])
      } else if (didYouMean.length > 0) {
        // No result rows: Enter accepts the top spelling suggestion.
        event.preventDefault()
        applySuggestion(didYouMean[0]!)
      }
      return
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      onRequestClose?.()
    }
  }

  let optionIndex = -1

  return (
    <div className={`${styles.autocomplete} ${className ?? ""}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          listOpen && flatItems[activeIndex]
            ? `${listId}-option-${flatItems[activeIndex]!.id}`
            : undefined
        }
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value)
          setOpen(true)
          setActiveIndex(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      <p className={styles.srOnly} id={statusId} role="status" aria-live="polite">
        {flatItems.length > 0 ? `${flatItems.length} suggestions` : trimmed ? "No suggestions" : ""}
      </p>

      {listOpen ? (
        <div className={styles.panel}>
          {flatItems.length === 0 && emptyMessage != null ? (
            <div className={styles.empty}>{emptyMessage}</div>
          ) : null}
          <div className={styles.list} role="listbox" id={listId} aria-label={ariaLabel}>
            {groups.map((group) => (
              <div key={group.label} className={styles.group} role="group" aria-label={group.label}>
                <div className={styles.groupLabel}>{group.label}</div>
                {group.items.map((entry) => {
                  optionIndex += 1
                  const index = optionIndex
                  const isActive = index === activeIndex
                  return (
                    <div
                      key={entry.id}
                      id={`${listId}-option-${entry.id}`}
                      role="option"
                      aria-selected={isActive}
                      className={`${styles.item}${isActive ? ` ${styles.itemActive}` : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => activate(entry)}
                    >
                      <span className={styles.itemTitle}>
                        <SearchHighlight text={entry.title} query={trimmed} />
                      </span>
                      {entry.subtitle ? (
                        <span className={styles.itemSubtitle}>
                          <SearchHighlight text={entry.subtitle} query={trimmed} />
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {hasChips ? (
            <div className={styles.chips}>
              {hasDidYouMean ? (
                <div className={styles.chipRow}>
                  <span className={styles.chipLabel}>Did you mean:</span>
                  {didYouMean.map((text) => (
                    <button
                      key={text}
                      type="button"
                      className={styles.chip}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySuggestion(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null}
              {hasRelated ? (
                <div className={styles.chipRow}>
                  <span className={styles.chipLabel}>Related:</span>
                  {related.slice(0, 4).map((text) => (
                    <button
                      key={text}
                      type="button"
                      className={styles.chip}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySuggestion(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null}
              {hasTrending ? (
                <div className={styles.chipRow}>
                  <span className={styles.chipLabel}>Trending:</span>
                  {trending.slice(0, 4).map((text) => (
                    <button
                      key={text}
                      type="button"
                      className={styles.chip}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySuggestion(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
