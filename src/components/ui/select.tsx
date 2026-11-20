"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon, Loader2Icon, SearchIcon } from "lucide-react"
import { Popover as PopoverPrimitive } from "radix-ui"

interface SelectOption {
  value: string
  label: React.ReactNode
  /** Text used for filtering when `label` is not a plain string. */
  keywords?: string
  disabled?: boolean
  /** Optional group heading rendered above the first option of each group. */
  group?: string
}

const triggerVariants = cva(
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-base shadow-xs transition-[color,box-shadow] outline-none select-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
  {
    variants: {
      size: {
        sm: "h-8 text-sm",
        default: "h-9",
      },
      invalid: {
        true: "border-destructive ring-destructive/20 focus-visible:ring-destructive/40 aria-invalid:border-destructive",
        false: "",
      },
    },
    defaultVariants: { size: "default", invalid: false },
  },
)

interface SelectProps extends VariantProps<typeof triggerVariants> {
  options: SelectOption[]
  /** Single mode: `string | null`. Multiple mode: `string[]`. */
  value?: string | string[] | null
  onChange?: (value: string | string[] | null) => void
  multiple?: boolean
  /** Show a filter input inside the dropdown. */
  searchable?: boolean
  /** Async loading state — shows a spinner row instead of options. */
  loading?: boolean
  loadingText?: string
  placeholder?: string
  /** Shown when there are no (matching) options. */
  emptyMessage?: string
  disabled?: boolean
  invalid?: boolean
  /** Custom trigger content for the selected value(s). */
  renderValue?: (selected: SelectOption[]) => React.ReactNode
  className?: string
  contentClassName?: string
  name?: string
  required?: boolean
  /** id for the trigger button — lets an external `<label htmlFor>` associate. */
  id?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
}

function optionText(option: SelectOption): string {
  return typeof option.label === "string" ? option.label : option.value
}

function matchesQuery(option: SelectOption, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    optionText(option).toLowerCase().includes(q) ||
    option.value.toLowerCase().includes(q) ||
    (option.keywords?.toLowerCase().includes(q) ?? false)
  )
}

function Select({
  options,
  value,
  onChange,
  multiple = false,
  searchable = false,
  loading = false,
  loadingText = "Loading…",
  placeholder = "Select…",
  emptyMessage,
  disabled = false,
  invalid,
  renderValue,
  className,
  contentClassName,
  size,
  name,
  required,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: SelectProps) {
  const listId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const typeaheadRef = React.useRef<{ buffer: string; timer?: ReturnType<typeof setTimeout> }>({
    buffer: "",
  })
  const listRef = React.useRef<HTMLDivElement>(null)
  const optionRefs = React.useRef(new Map<string, HTMLDivElement>())
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const selectedValues = React.useMemo(() => {
    if (multiple) return Array.isArray(value) ? value : value ? [value] : []
    return typeof value === "string" && value ? [value] : []
  }, [value, multiple])

  const selectedOptions = React.useMemo(
    () => options.filter((o) => selectedValues.includes(o.value)),
    [options, selectedValues],
  )

  const filteredOptions = React.useMemo(
    () => options.filter((o) => matchesQuery(o, query)),
    [options, query],
  )

  // Selectable (non-disabled) options in render order — the keyboard index space.
  const navigable = React.useMemo(
    () => filteredOptions.filter((o) => !o.disabled),
    [filteredOptions],
  )

  const triggerLabel = React.useMemo(() => {
    if (selectedOptions.length === 0) {
      return <span className="text-muted-foreground">{placeholder}</span>
    }
    if (renderValue) return renderValue(selectedOptions)
    if (multiple) {
      return selectedOptions.map((o) => optionText(o)).join(", ")
    }
    return optionText(selectedOptions[0])
  }, [selectedOptions, multiple, placeholder, renderValue])

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery("")
    setActiveIndex(-1)
  }, [])

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true)
      setActiveIndex(navigable.findIndex((o) => selectedValues.includes(o.value)))
    } else {
      close()
    }
  }

  const selectOption = (option: SelectOption) => {
    if (option.disabled) return
    if (multiple) {
      const current = Array.isArray(value) ? value : []
      const next = current.includes(option.value)
        ? current.filter((v) => v !== option.value)
        : [...current, option.value]
      onChange?.(next)
      // Keep the dropdown open and refocus the search input, if any.
      setActiveIndex(navigable.findIndex((o) => o.value === option.value))
      requestAnimationFrame(() => searchInputRef.current?.focus())
    } else {
      onChange?.(option.value)
      close()
    }
  }

  const moveActive = (delta: number) => {
    if (navigable.length === 0) return
    setActiveIndex((prev) => {
      const base = prev === -1 ? (delta > 0 ? -1 : 0) : prev
      const next = (base + delta + navigable.length) % navigable.length
      return next
    })
  }

  const handleTypeahead = (key: string) => {
    const state = typeaheadRef.current
    clearTimeout(state.timer)
    state.buffer += key.toLowerCase()
    state.timer = setTimeout(() => {
      state.buffer = ""
    }, 500)
    const match = navigable.find((o) => optionText(o).toLowerCase().startsWith(state.buffer))
    if (match) {
      const idx = navigable.indexOf(match)
      setActiveIndex(idx)
      optionRefs.current.get(match.value)?.scrollIntoView({ block: "nearest" })
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled || loading) return
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
      event.preventDefault()
      const active = navigable[activeIndex]
      if (active) selectOption(active)
    } else if (event.key === "Escape") {
      close()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Printable character — typeahead (unless the search input is handling it).
      if (!(searchable && event.target === searchInputRef.current)) {
        handleTypeahead(event.key)
      }
    }
  }

  // Keep the active option visible while arrow-keying.
  React.useEffect(() => {
    if (activeIndex >= 0) {
      const active = navigable[activeIndex]
      if (active) optionRefs.current.get(active.value)?.scrollIntoView({ block: "nearest" })
    }
  }, [activeIndex, navigable])

  // Move focus into the dropdown when it opens: the search input when
  // searchable, otherwise the listbox container so arrow-key navigation works.
  React.useEffect(() => {
    if (!open || loading) return
    const id = requestAnimationFrame(() => {
      if (searchable) searchInputRef.current?.focus()
      else listRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open, searchable, loading])

  // Reset search when the dropdown closes.
  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const resolvedEmpty = emptyMessage ?? (query ? "No results found." : "No options.")

  // DOM id of the keyboard-active option, for aria-activedescendant.
  const activeOption = navigable[activeIndex]
  const activeDescendantId =
    open && activeOption ? `${listId}-opt-${filteredOptions.indexOf(activeOption)}` : undefined

  // Render flat list with inline group labels.
  const rows: React.ReactNode[] = []
  let lastGroup: string | undefined
  filteredOptions.forEach((option, optionIndex) => {
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
    const isActive = !option.disabled && navigable[activeIndex]?.value === option.value
    rows.push(
      <div
        key={option.value}
        id={`${listId}-opt-${optionIndex}`}
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

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          id={id}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={invalid || undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          data-slot="select-trigger"
          data-size={size ?? "default"}
          className={cn(
            triggerVariants({ size, invalid }),
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
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
          data-slot="select-content"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            // Radix would focus the content; we manage focus ourselves.
            event.preventDefault()
          }}
          className={cn(
            "bg-popover text-popover-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 max-h-72 w-(--radix-popover-trigger-width) min-w-[8rem] origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border shadow-md outline-hidden",
            contentClassName,
          )}
        >
          <div
            ref={listRef}
            role="listbox"
            id={listId}
            aria-multiselectable={multiple || undefined}
            aria-label={placeholder}
            aria-busy={loading || undefined}
            aria-activedescendant={activeDescendantId}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            className="max-h-72 overflow-y-auto p-1 outline-hidden"
          >
            {searchable ? (
              <div className="relative mb-1">
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
                  aria-label="Search options"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setActiveIndex(-1)
                  }}
                  placeholder="Search…"
                  className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-full rounded-sm border bg-transparent pr-2 pl-8 text-sm outline-hidden focus-visible:ring-[3px]"
                />
              </div>
            ) : null}
            {loading ? (
              <div
                role="status"
                className="text-muted-foreground flex items-center justify-center gap-2 px-2 py-6 text-sm"
              >
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                {loadingText}
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="text-muted-foreground px-2 py-6 text-center text-sm">
                {resolvedEmpty}
              </div>
            ) : (
              rows
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { Select }
export type { SelectOption, SelectProps }
