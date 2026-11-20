"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"

/* ------------------------------------------------------------------ */
/* Low-level table primitives                                          */
/* ------------------------------------------------------------------ */

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("bg-muted/50 border-t font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-3 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

/* ------------------------------------------------------------------ */
/* DataTable                                                            */
/* ------------------------------------------------------------------ */

export type SortDirection = "asc" | "desc"

export interface SortState {
  key: string
  direction: SortDirection
}

export interface DataTableColumn<T> {
  /** Unique column id — also used as the sort key. */
  id: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number | null | undefined
  /** Text used by the global search filter for this column. */
  filterText?: (row: T) => string
  align?: "left" | "center" | "right"
  className?: string
  headClassName?: string
}

export interface DataTableProps<T> {
  data: T[]
  columns: DataTableColumn<T>[]
  /** Stable row id used for selection keys. Defaults to the row index. */
  getRowId?: (row: T, index: number) => string

  /** Renders a global search input that filters across all columns. */
  searchable?: boolean
  searchPlaceholder?: string

  /** Controlled sorting state. Pass `null` for unsorted. */
  sorting?: SortState | null
  /** Called with the next sort state (or `null` when sorting is cleared). */
  onSortingChange?: (sorting: SortState | null) => void
  /** Initial sort state for uncontrolled usage. */
  initialSorting?: SortState | null

  /** Row selection. Pass `selectedIds` + `onSelectionChange` to control. */
  selectable?: boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void

  /** Pagination. Enabled by default; disable with `pagination={false}`. */
  pagination?: boolean
  pageSize?: number
  pageSizeOptions?: number[]

  /** Simple fixed-height windowing for large datasets. Disables pagination. */
  virtualize?: boolean
  rowHeight?: number
  /** Height of the virtual scroll viewport in px. */
  virtualHeight?: number
  /** Extra rows rendered above/below the visible window. */
  overscan?: number

  stickyHeader?: boolean
  loading?: boolean
  /** Number of skeleton rows shown while `loading`. Defaults to 5. */
  loadingRows?: number
  /** Rendered inside a full-width row when there is no data. */
  emptyState?: React.ReactNode
  /** Extra content rendered in a toolbar row above the table. */
  toolbar?: React.ReactNode
  /** Makes rows clickable and keyboard focusable. */
  onRowClick?: (row: T) => void

  className?: string
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50]

const alignClass: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

function nextSortState(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "asc" }
  if (current.direction === "asc") return { key, direction: "desc" }
  return null
}

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set<number>([1, total, current - 1, current, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const result: (number | "ellipsis")[] = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) result.push("ellipsis")
    result.push(p)
    prev = p
  }
  return result
}

function SortableHead<T>({
  column,
  sorting,
  onToggle,
  sticky,
}: {
  column: DataTableColumn<T>
  sorting: SortState | null
  onToggle: (key: string) => void
  sticky: boolean
}) {
  const active = sorting?.key === column.id ? sorting.direction : null
  return (
    <TableHead
      aria-sort={active ? (active === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        alignClass[column.align ?? "left"],
        column.headClassName,
        sticky && "bg-background sticky top-0 z-10",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(column.id)}
        className="hover:text-foreground/80 focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        {column.header}
        {active === "asc" ? (
          <ArrowUpIcon className="size-3.5" aria-hidden="true" />
        ) : active === "desc" ? (
          <ArrowDownIcon className="size-3.5" aria-hidden="true" />
        ) : (
          <ArrowUpDownIcon className="size-3.5 opacity-40" aria-hidden="true" />
        )}
      </button>
    </TableHead>
  )
}

function DataTable<T>({
  data,
  columns,
  getRowId,
  searchable = false,
  searchPlaceholder = "Search…",
  sorting: sortingProp,
  onSortingChange,
  initialSorting = null,
  selectable = false,
  selectedIds: selectedIdsProp,
  onSelectionChange,
  pagination = true,
  pageSize: initialPageSize = 10,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  virtualize = false,
  rowHeight = 48,
  virtualHeight = 480,
  overscan = 8,
  stickyHeader = false,
  loading = false,
  loadingRows = 5,
  emptyState,
  toolbar,
  onRowClick,
  className,
}: DataTableProps<T>) {
  /* ------------------------------ filtering ------------------------------ */
  const [query, setQuery] = React.useState("")

  const rowText = React.useCallback(
    (row: T) =>
      columns
        .map((col) => {
          if (col.filterText) return col.filterText(row)
          if (col.sortValue) {
            const v = col.sortValue(row)
            return v == null ? "" : String(v)
          }
          return ""
        })
        .join(" "),
    [columns],
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data
    return data.filter((row) => rowText(row).toLowerCase().includes(q))
  }, [data, query, rowText])

  /* ------------------------------- sorting -------------------------------- */
  const [internalSort, setInternalSort] = React.useState<SortState | null>(initialSorting)
  const sorting = sortingProp !== undefined ? sortingProp : internalSort
  const setSorting = React.useCallback(
    (next: SortState | null) => {
      onSortingChange?.(next)
      if (sortingProp === undefined) setInternalSort(next)
    },
    [onSortingChange, sortingProp],
  )
  const toggleSort = React.useCallback(
    (key: string) => setSorting(nextSortState(sorting, key)),
    [sorting, setSorting],
  )

  const sorted = React.useMemo(() => {
    if (!sorting) return filtered
    const col = columns.find((c) => c.id === sorting.key)
    if (!col?.sortValue) return filtered
    const dir = sorting.direction === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [filtered, sorting, columns])

  /* ------------------------------ selection ------------------------------- */
  const idOf = React.useCallback(
    (row: T, index: number) => getRowId?.(row, index) ?? String(index),
    [getRowId],
  )

  const [internalSelected, setInternalSelected] = React.useState<string[]>([])
  const selected = selectedIdsProp !== undefined ? selectedIdsProp : internalSelected
  const setSelected = React.useCallback(
    (ids: string[]) => {
      onSelectionChange?.(ids)
      if (selectedIdsProp === undefined) setInternalSelected(ids)
    },
    [onSelectionChange, selectedIdsProp],
  )

  /* ------------------------------ pagination ------------------------------ */
  const [pageSize, setPageSize] = React.useState(initialPageSize)
  const [page, setPage] = React.useState(1)

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const paged = React.useMemo(() => {
    if (virtualize || !pagination) return sorted
    const start = (safePage - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, virtualize, pagination, safePage, pageSize])

  /* ------------------------------ virtualization -------------------------- */
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(virtualHeight)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !virtualize) return
    setViewportHeight(el.clientHeight || virtualHeight)
  }, [virtualize, virtualHeight])

  const virtualRange = React.useMemo(() => {
    if (!virtualize) return { start: 0, end: paged.length }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const visible = Math.ceil(viewportHeight / rowHeight)
    const end = Math.min(paged.length, start + visible + overscan * 2)
    return { start, end }
  }, [virtualize, paged.length, scrollTop, rowHeight, viewportHeight, overscan])

  const visibleRows = virtualize ? paged.slice(virtualRange.start, virtualRange.end) : paged
  const topPad = virtualize ? virtualRange.start * rowHeight : 0
  const bottomPad = virtualize ? Math.max(0, (paged.length - virtualRange.end) * rowHeight) : 0

  /* ------------------------------- helpers -------------------------------- */
  // Index of the first rendered row within `sorted` — used for fallback row
  // ids so select-all and per-row checkboxes agree on every page/mode.
  const rowBaseIndex = virtualize ? virtualRange.start : pagination ? (safePage - 1) * pageSize : 0
  const visibleIds = visibleRows.map((row, i) => idOf(row, rowBaseIndex + i))
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id))
  const selectAllState: boolean | "indeterminate" = allVisibleSelected
    ? true
    : someVisibleSelected
      ? "indeterminate"
      : false

  const toggleRow = (id: string) => {
    setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelected(selected.filter((id) => !visibleIds.includes(id)))
    } else {
      setSelected([...new Set([...selected, ...visibleIds])])
    }
  }

  const sortAnnouncement = sorting
    ? `Sorted by ${columns.find((c) => c.id === sorting.key)?.header ?? sorting.key} ${sorting.direction === "asc" ? "ascending" : "descending"}`
    : ""

  const colSpan = columns.length + (selectable ? 1 : 0)
  const showPagination = pagination && !virtualize && sorted.length > 0
  const rangeStart = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeEnd = Math.min(sorted.length, safePage * pageSize)

  const pages = pageNumbers(safePage, totalPages)

  const headSticky = stickyHeader || virtualize

  /* -------------------------------- render -------------------------------- */
  return (
    <div data-slot="data-table" className={cn("flex flex-col gap-3", className)}>
      {(searchable || toolbar) && (
        <div className="flex items-center gap-2">
          {searchable && (
            <Input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="max-w-xs"
            />
          )}
          {toolbar && <div className="ml-auto">{toolbar}</div>}
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {sortAnnouncement}
      </div>

      {virtualize ? (
        <div
          ref={scrollRef}
          data-slot="data-table-viewport"
          className="overflow-y-auto rounded-md border"
          style={{ height: virtualHeight }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <Table aria-busy={loading || undefined}>
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead
                    className={cn("w-10", headSticky && "bg-background sticky top-0 z-10")}
                  >
                    <Checkbox
                      checked={selectAllState}
                      onCheckedChange={toggleAll}
                      aria-label="Select all rows"
                    />
                  </TableHead>
                )}
                {columns.map((col) =>
                  col.sortValue ? (
                    <SortableHead
                      key={col.id}
                      column={col}
                      sorting={sorting}
                      onToggle={toggleSort}
                      sticky={headSticky}
                    />
                  ) : (
                    <TableHead
                      key={col.id}
                      aria-sort="none"
                      className={cn(
                        alignClass[col.align ?? "left"],
                        col.headClassName,
                        headSticky && "bg-background sticky top-0 z-10",
                      )}
                    >
                      {col.header}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPad > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: topPad, padding: 0, border: 0 }} />
                </tr>
              )}
              {loading ? (
                Array.from({ length: loadingRows }, (_, i) => (
                  <TableRow key={`skeleton-${i}`} aria-hidden="true">
                    {selectable && (
                      <TableCell>
                        <div className="bg-muted size-4 animate-pulse rounded" />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell key={col.id} className={col.className}>
                        <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="text-muted-foreground h-24 text-center">
                    {emptyState ?? "No results."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row, i) => {
                  const rowIndex = rowBaseIndex + i
                  const id = idOf(row, rowIndex)
                  return (
                    <TableRow
                      key={id}
                      data-state={selected.includes(id) ? "selected" : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn(onRowClick && "cursor-pointer")}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                onRowClick(row)
                              }
                            }
                          : undefined
                      }
                    >
                      {selectable && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.includes(id)}
                            onCheckedChange={() => toggleRow(id)}
                            aria-label={`Select row ${rowIndex + 1}`}
                          />
                        </TableCell>
                      )}
                      {columns.map((col) => (
                        <TableCell
                          key={col.id}
                          className={cn(alignClass[col.align ?? "left"], col.className)}
                        >
                          {col.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })
              )}
              {bottomPad > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={colSpan} style={{ height: bottomPad, padding: 0, border: 0 }} />
                </tr>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table aria-busy={loading || undefined}>
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead
                    className={cn("w-10", headSticky && "bg-background sticky top-0 z-10")}
                  >
                    <Checkbox
                      checked={selectAllState}
                      onCheckedChange={toggleAll}
                      aria-label="Select all rows"
                    />
                  </TableHead>
                )}
                {columns.map((col) =>
                  col.sortValue ? (
                    <SortableHead
                      key={col.id}
                      column={col}
                      sorting={sorting}
                      onToggle={toggleSort}
                      sticky={headSticky}
                    />
                  ) : (
                    <TableHead
                      key={col.id}
                      aria-sort="none"
                      className={cn(
                        alignClass[col.align ?? "left"],
                        col.headClassName,
                        headSticky && "bg-background sticky top-0 z-10",
                      )}
                    >
                      {col.header}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: loadingRows }, (_, i) => (
                  <TableRow key={`skeleton-${i}`} aria-hidden="true">
                    {selectable && (
                      <TableCell>
                        <div className="bg-muted size-4 animate-pulse rounded" />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell key={col.id} className={col.className}>
                        <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpan} className="text-muted-foreground h-24 text-center">
                    {emptyState ?? "No results."}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((row, i) => {
                  const rowIndex = rowBaseIndex + i
                  const id = idOf(row, rowIndex)
                  return (
                    <TableRow
                      key={id}
                      data-state={selected.includes(id) ? "selected" : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn(onRowClick && "cursor-pointer")}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                onRowClick(row)
                              }
                            }
                          : undefined
                      }
                    >
                      {selectable && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.includes(id)}
                            onCheckedChange={() => toggleRow(id)}
                            aria-label={`Select row ${rowIndex + 1}`}
                          />
                        </TableCell>
                      )}
                      {columns.map((col) => (
                        <TableCell
                          key={col.id}
                          className={cn(alignClass[col.align ?? "left"], col.className)}
                        >
                          {col.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {showPagination && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>
              Showing {rangeStart}–{rangeEnd} of {sorted.length}
            </span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              aria-label="First page"
            >
              <ChevronsLeftIcon aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 1}
              aria-label="Previous page"
            >
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            {pages.map((p, i) =>
              p === "ellipsis" ? (
                <span key={`e-${i}`} className="px-1">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === safePage ? "default" : "outline"}
                  size="icon-sm"
                  onClick={() => setPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === safePage ? "page" : undefined}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage === totalPages}
              aria-label="Next page"
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              aria-label="Last page"
            >
              <ChevronsRightIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  DataTable,
}
