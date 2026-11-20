"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

/** A single selectable option. `group` renders a non-selectable heading above it. */
interface AsyncSelectOption {
  value: string
  label: React.ReactNode
  /** Text used for filtering when `label` is not a plain string. */
  keywords?: string
  disabled?: boolean
  /** Optional group heading rendered above the first option of each group. */
  group?: string
}

/** A labeled group of options (optgroup-style). */
interface AsyncSelectGroup {
  label: string
  options: AsyncSelectOption[]
}

/**
 * The shape `searchOptions` may resolve to: a flat list of options (each may
 * carry `group`), or an explicit list of labeled groups.
 */
type AsyncSelectResult = (AsyncSelectOption | AsyncSelectGroup)[]

type SearchOptionsFn = (
  query: string,
  signal: AbortSignal,
) => Promise<AsyncSelectResult> | AsyncSelectResult

const triggerVariants = cva(
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-base shadow-xs transition-[color,box-shadow] outline-none select-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
  {
    variants: {
      size: {
        sm: "h-8 text-sm",
        default: "min-h-9",
      },
      invalid: {
        true: "border-destructive ring-destructive/20 focus-visible:ring-destructive/40 aria-invalid:border-destructive",
        false: "",
      },
    },
    defaultVariants: { size: "default", invalid: false },
  },
)

interface AsyncSelectProps extends VariantProps<typeof triggerVariants> {
  /** Async search function. Receives the trimmed query and an AbortSignal. */
  searchOptions: SearchOptionsFn
  /** Single mode: `string | null`. Multiple mode: `string[]`. */
  value?: string | string[] | null
  onChange?: (value: string | string[] | null) => void
  multiple?: boolean
  placeholder?: string
  /** Shown when the search resolves to no options. */
  emptyMessage?: string
  /** Shown when the query is shorter than `minQueryLength`. */
  minQueryMessage?: string
  /** Options shown before any search runs (e.g. on open with an empty query). */
  initialOptions?: AsyncSelectOption[]
  /**
   * Labels for currently-selected values that may not be in any fetched result
   * set (e.g. values restored from a server). Used to render chips/labels.
   */
  selectedOptions?: AsyncSelectOption[]
  /** Debounce applied to the query before `searchOptions` is invoked. */
  debounceMs?: number
  /** Minimum trimmed query length required before searching. `0` searches on open. */
  minQueryLength?: number
  /** How long a cached query result stays fresh (stale-while-revalidate after). */
  cacheTtlMs?: number
  /** Maximum number of query results retained in the in-memory cache. */
  cacheMaxSize?: number
  loadingText?: string
  errorMessage?: string
  disabled?: boolean
  invalid?: boolean
  className?: string
  contentClassName?: string
  name?: string
  required?: boolean
  "aria-label"?: string
}

type FetchStatus = "idle" | "loading" | "success" | "error"

interface CacheEntry {
  options: AsyncSelectOption[]
  fetchedAt: number
}

/** Tiny LRU-ish cache: Map iteration order gives recency; `get` refreshes it. */
class QueryCache {
  private map = new Map<string, CacheEntry>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
  ) {}

  get(key: string): CacheEntry | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    // Refresh recency.
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(key: string, options: AsyncSelectOption[]) {
    this.map.delete(key)
    this.map.set(key, { options, fetchedAt: Date.now() })
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.fetchedAt < this.ttlMs
  }
}

function normalizeQueryKey(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase()
}

function isGroup(item: AsyncSelectOption | AsyncSelectGroup): item is AsyncSelectGroup {
  return (
    typeof item === "object" &&
    item !== null &&
    "options" in item &&
    Array.isArray((item as AsyncSelectGroup).options)
  )
}

/** Flatten a possibly-grouped result into a flat option list carrying `group`. */
function flattenOptions(result: AsyncSelectResult): AsyncSelectOption[] {
  const flat: AsyncSelectOption[] = []
  for (const item of result) {
    if (isGroup(item)) {
      for (const option of item.options) {
        flat.push({ ...option, group: option.group ?? item.label })
      }
    } else {
      flat.push(item)
    }
  }
  return flat
}

function optionText(option: AsyncSelectOption): string {
  return typeof option.label === "string" ? option.label : option.value
}

function AsyncSelect({
  searchOptions,
  value,
  onChange,
  multiple = false,
  placeholder = "Select…",
  emptyMessage,
  minQueryMessage,
  initialOptions,
  selectedOptions: selectedOptionsProp,
  debounceMs = 250,
  minQueryLength = 0,
  cacheTtlMs = 60_000,
  cacheMaxSize = 100,
  loadingText = "Loading…",
  errorMessage = "Failed to load options.",
  disabled = false,
  invalid,
  className,
  contentClassName,
  size,
  name,
  required,
  "aria-label": ariaLabel,
}: AsyncSelectProps) {
  const listId = React.useId()
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const optionRefs = React.useRef(new Map<string, HTMLDivElement>())
  const abortRef = React.useRef<AbortController | null>(null)

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<AsyncSelectOption[]>(() =>
    initialOptions ? flattenOptions(initialOptions) : [],
  )
  const [status, setStatus] = React.useState<FetchStatus>("idle")
  const [activeIndex, setActiveIndex] = React.useState(-1)

  // In-memory cache keyed by normalized query + a cache of resolved option
  // objects so chips/labels render without refetching.
  const cacheRef = React.useRef<QueryCache | null>(null)
  if (!cacheRef.current) cacheRef.current = new QueryCache(cacheTtlMs, cacheMaxSize)
  const knownOptionsRef = React.useRef(new Map<string, AsyncSelectOption>())

  // Latest values for async callbacks without stale closures.
  const stateRef = React.useRef({ query: "" })
  stateRef.current.query = query
  const searchOptionsRef = React.useRef(searchOptions)
  searchOptionsRef.current = searchOptions

  const selectedValues = React.useMemo(() => {
    if (multiple) return Array.isArray(value) ? value : value ? [value] : []
    return typeof value === "string" && value ? [value] : []
  }, [value, multiple])

  const selectedValuesRef = React.useRef(selectedValues)
  selectedValuesRef.current = selectedValues

  const rememberOptions = React.useCallback((options: AsyncSelectOption[]) => {
    for (const option of options) knownOptionsRef.current.set(option.value, option)
  }, [])

  React.useEffect(() => {
    if (initialOptions) rememberOptions(flattenOptions(initialOptions))
  }, [initialOptions, rememberOptions])

  React.useEffect(() => {
    rememberOptions(selectedOptionsProp ?? [])
  }, [selectedOptionsProp, rememberOptions])

  const resolveOption = React.useCallback(
    (val: string): AsyncSelectOption => {
      const known = knownOptionsRef.current.get(val)
      if (known) return known
      const fromProp = selectedOptionsProp?.find((o) => o.value === val)
      if (fromProp) return fromProp
      return { value: val, label: val }
    },
    [selectedOptionsProp],
  )

  const selectedOptions = React.useMemo(
    () => selectedValues.map(resolveOption),
    [selectedValues, resolveOption],
  )

  const trimmedQuery = query.trim()
  const cacheKey = normalizeQueryKey(query)

  const applyResults = React.useCallback(
    (options: AsyncSelectOption[], resetActive: boolean) => {
      rememberOptions(options)
      setResults(options)
      if (resetActive) {
        const selected = selectedValuesRef.current
        const firstSelected = options.findIndex((o) => selected.includes(o.value) && !o.disabled)
        setActiveIndex(firstSelected >= 0 ? firstSelected : options.length > 0 ? 0 : -1)
      }
    },
    [rememberOptions],
  )

  const runSearch = React.useCallback(
    async (key: string, displayQuery: string, force = false) => {
      const cache = cacheRef.current!
      const cached = cache.get(key)
      const fresh = cached !== undefined && cache.isFresh(cached)

      // Stale-while-revalidate: show cached results immediately, refetch anyway.
      if (cached && !force) {
        applyResults(cached.options, true)
        if (fresh) {
          setStatus("success")
          return
        }
      }

      setStatus("loading")
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const raw = await searchOptionsRef.current(displayQuery, controller.signal)
        if (controller.signal.aborted) return
        const flat = flattenOptions(raw ?? [])
        cache.set(key, flat)
        rememberOptions(flat)
        // Only apply if this is still the active query.
        if (normalizeQueryKey(stateRef.current.query) === key) {
          applyResults(flat, true)
          setStatus("success")
        }
      } catch {
        if (controller.signal.aborted) return
        if (normalizeQueryKey(stateRef.current.query) === key) {
          setStatus("error")
        }
      }
    },
    [applyResults, rememberOptions],
  )

  // Debounced search effect. Aborts in-flight requests when the query changes
  // or the dropdown closes.
  React.useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      abortRef.current = null
      return
    }
    if (trimmedQuery.length < minQueryLength) {
      abortRef.current?.abort()
      setStatus("idle")
      setResults(initialOptions ? flattenOptions(initialOptions) : [])
      setActiveIndex(-1)
      return
    }

    const timer = setTimeout(() => {
      void runSearch(cacheKey, trimmedQuery)
    }, debounceMs)
    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [open, cacheKey, trimmedQuery, minQueryLength, debounceMs, runSearch])

  // Abort any in-flight request on unmount.
  React.useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Selectable (non-disabled) options in render order — the keyboard index space.
  const navigable = React.useMemo(() => results.filter((o) => !o.disabled), [results])

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery("")
    setActiveIndex(-1)
  }, [])

  const openDropdown = React.useCallback(() => {
    if (disabled) return
    setOpen(true)
    // Focus is moved into the search input by the effect below.
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [disabled])

  const selectOption = (option: AsyncSelectOption) => {
    if (option.disabled) return
    rememberOptions([option])
    if (multiple) {
      const current = Array.isArray(value) ? value : []
      const next = current.includes(option.value)
        ? current.filter((v) => v !== option.value)
        : [...current, option.value]
      onChange?.(next)
      const idx = navigable.findIndex((o) => o.value === option.value)
      setActiveIndex(idx >= 0 ? idx : -1)
      requestAnimationFrame(() => searchInputRef.current?.focus())
    } else {
      onChange?.(option.value)
      close()
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }

  const removeValue = (val: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (!multiple) return
    const current = Array.isArray(value) ? value : []
    onChange?.(current.filter((v) => v !== val))
  }

  const moveActive = (delta: number) => {
    if (navigable.length === 0) return
    setActiveIndex((prev) => {
      const base = prev === -1 ? (delta > 0 ? -1 : 0) : prev
      const next = (base + delta + navigable.length) % navigable.length
      return next
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    const onSearchInput = event.target === searchInputRef.current

    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(Math.max(0, navigable.length - 1))
    } else if (event.key === "Enter") {
      // In the search input Enter selects the active option (it never submits).
      event.preventDefault()
      const active = navigable[activeIndex]
      if (active) selectOption(active)
    } else if (event.key === " " && !onSearchInput) {
      // Space selects when focus is on the listbox; in the input it types a space.
      event.preventDefault()
      const active = navigable[activeIndex]
      if (active) selectOption(active)
    } else if (event.key === "Backspace" && multiple) {
      // Backspace on an empty search input removes the last chip.
      if (onSearchInput && searchInputRef.current && searchInputRef.current.value === "") {
        const last = selectedValues[selectedValues.length - 1]
        if (last !== undefined) {
          event.preventDefault()
          onChange?.(selectedValues.filter((v) => v !== last))
        }
      }
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }

  // Keep the active option visible while arrow-keying.
  React.useEffect(() => {
    if (activeIndex >= 0) {
      const active = navigable[activeIndex]
      if (active) optionRefs.current.get(active.value)?.scrollIntoView({ block: "nearest" })
    }
  }, [activeIndex, navigable])

  // Move focus into the search input when the dropdown opens.
  React.useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const resolvedEmpty = emptyMessage ?? (trimmedQuery ? "No results found." : "No options.")
  const belowMinQuery = trimmedQuery.length < minQueryLength
  const minQueryText =
    minQueryMessage ??
    `Type at least ${minQueryLength} character${minQueryLength === 1 ? "" : "s"} to search.`

  const activeOption = navigable[activeIndex]
  const activeDescendantId =
    open && activeOption ? `${listId}-opt-${results.indexOf(activeOption)}` : undefined

  // Render flat list with inline group headers (non-selectable).
  const rows: React.ReactNode[] = []
  let lastGroup: string | undefined
  results.forEach((option, resultIndex) => {
    if (option.group !== lastGroup) {
      lastGroup = option.group
      if (option.group) {
        rows.push(
          <div
            key={`group-${option.group}`}
            role="presentation"
            className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium"
          >
            {option.group}
          </div>,
        )
      }
    }
    const isSelected = selectedValues.includes(option.value)
    const isActive = !option.disabled && activeOption?.value === option.value
    const optionId = `${listId}-opt-${resultIndex}`
    rows.push(
      <div
        key={option.value}
        id={optionId}
        ref={(el) => {
          if (el) optionRefs.current.set(option.value, el)
          else optionRefs.current.delete(option.value)
        }}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        data-active={isActive || undefined}
        data-disabled={option.disabled || undefined}
        onMouseEnter={() => {
          if (!option.disabled) {
            const idx = navigable.findIndex((o) => o.value === option.value)
            if (idx !== -1) setActiveIndex(idx)
          }
        }}
        onClick={() => selectOption(option)}
        className={cn(
          "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none",
          isActive && "bg-accent text-accent-foreground",
          option.disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
          {isSelected && <CheckIcon className="size-4" aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
      </div>,
    )
  })

  const triggerContent =
    selectedOptions.length === 0 ? (
      <span className="text-muted-foreground min-w-0 flex-1 truncate">{placeholder}</span>
    ) : multiple ? (
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {selectedOptions.map((option) => (
          <span
            key={option.value}
            data-slot="async-select-chip"
            className="bg-muted text-foreground inline-flex max-w-full items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium"
          >
            <span className="truncate">{optionText(option)}</span>
            <button
              type="button"
              aria-label={`Remove ${optionText(option)}`}
              disabled={disabled}
              onClick={(event) => removeValue(option.value, event)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px] disabled:pointer-events-none"
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </span>
    ) : (
      <span className="min-w-0 flex-1 truncate">{optionText(selectedOptions[0])}</span>
    )

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) openDropdown()
        else close()
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <div
          ref={triggerRef}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          data-slot="async-select-trigger"
          data-size={size ?? "default"}
          onKeyDown={(event) => {
            if (open) return
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
              event.preventDefault()
              if (!disabled) setOpen(true)
            }
          }}
          className={cn(
            triggerVariants({ size, invalid }),
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            className,
          )}
        >
          {triggerContent}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("shrink-0 transition-transform", open && "rotate-180")}
          />
        </div>
      </PopoverPrimitive.Trigger>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={multiple ? selectedValues.join(",") : (selectedValues[0] ?? "")}
          required={required && selectedValues.length === 0}
          tabIndex={-1}
        />
      ) : null}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="async-select-content"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            // We manage focus ourselves (the search input).
            event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
          className={cn(
            "bg-popover text-popover-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 max-h-72 w-(--radix-popover-trigger-width) min-w-[8rem] origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border shadow-md outline-hidden",
            contentClassName,
          )}
        >
          <div className="border-b px-2 py-1.5">
            <div className="relative">
              <SearchIcon
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
              />
              <input
                ref={searchInputRef}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={activeDescendantId}
                aria-autocomplete="list"
                aria-label={ariaLabel ? `${ariaLabel} search` : "Search options"}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(-1)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search…"
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full rounded-sm border bg-transparent pr-2 pl-8 text-sm outline-hidden focus-visible:ring-[3px]"
              />
            </div>
          </div>
          <div
            ref={listRef}
            role="listbox"
            id={listId}
            aria-multiselectable={multiple || undefined}
            aria-label={ariaLabel ?? placeholder}
            aria-busy={status === "loading" || undefined}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            className="max-h-64 overflow-y-auto p-1 outline-hidden"
          >
            {status === "loading" && results.length === 0 ? (
              <div
                role="status"
                className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm"
              >
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                {loadingText}
              </div>
            ) : status === "error" && results.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 px-2 py-6 text-sm">
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => {
                    const key = normalizeQueryKey(stateRef.current.query)
                    void runSearch(key, stateRef.current.query.trim(), true)
                  }}
                  className="border-input text-foreground hover:bg-accent focus-visible:ring-ring/50 rounded-sm border px-2 py-1 text-xs font-medium outline-none focus-visible:ring-[3px]"
                >
                  Retry
                </button>
              </div>
            ) : belowMinQuery && trimmedQuery.length > 0 ? (
              <div className="text-muted-foreground px-2 py-6 text-center text-sm">
                {minQueryText}
              </div>
            ) : results.length === 0 ? (
              <div className="text-muted-foreground px-2 py-6 text-center text-sm">
                {status === "idle" && trimmedQuery.length === 0
                  ? minQueryLength > 0
                    ? minQueryText
                    : "Type to search…"
                  : resolvedEmpty}
              </div>
            ) : (
              <>
                {status === "loading" ? (
                  <div
                    role="status"
                    className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs"
                  >
                    <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
                    {loadingText}
                  </div>
                ) : null}
                {status === "error" ? (
                  <div className="text-destructive flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <span>{errorMessage}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const key = normalizeQueryKey(stateRef.current.query)
                        void runSearch(key, stateRef.current.query.trim(), true)
                      }}
                      className="border-input text-foreground hover:bg-accent focus-visible:ring-ring/50 rounded-sm border px-1.5 py-0.5 font-medium outline-none focus-visible:ring-[3px]"
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {rows}
              </>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { AsyncSelect }
export type {
  AsyncSelectGroup,
  AsyncSelectOption,
  AsyncSelectProps,
  AsyncSelectResult,
  SearchOptionsFn,
}
