"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

import type { DataGridColumn, DataGridProps, FilterState, SortState } from "./types"
import {
  applyRowClickSelection,
  applySelectAll,
  clampWidth,
  computeVirtualRange,
  filterRows,
  nextSortState,
  pageRowCount,
  resolveColumnWidth,
  rowIndexAtScrollTop,
  sortRows,
} from "./utils"

const DEFAULT_ROW_HEIGHT = 40
const DEFAULT_HEIGHT = 480
const DEFAULT_OVERSCAN = 8
const DEFAULT_COLUMN_WIDTH = 160
const MIN_COLUMN_WIDTH = 60
const MAX_COLUMN_WIDTH = 1200
const HEADER_HEIGHT = 44
const STORAGE_PREFIX = "spindle:data-grid-widths:"

const alignClass: Record<NonNullable<DataGridColumn<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

function loadStoredWidths(storageKey: string | undefined): Record<string, number> {
  if (!storageKey || typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function computeColumnMetrics<T>(
  columns: DataGridColumn<T>[],
  overrides: Record<string, number>,
  defaultWidth: number,
): {
  widths: Record<string, number>
  totalWidth: number
  leftOffsets: Record<string, number>
  rightOffsets: Record<string, number>
} {
  const widths: Record<string, number> = {}
  let totalWidth = 0
  for (const col of columns) {
    const w = overrides[col.id] ?? resolveColumnWidth(col, defaultWidth)
    widths[col.id] = w
    totalWidth += w
  }
  const leftOffsets: Record<string, number> = {}
  let left = 0
  for (const col of columns) {
    if (col.pinned === "left") {
      leftOffsets[col.id] = left
      left += widths[col.id]
    }
  }
  const rightOffsets: Record<string, number> = {}
  let right = 0
  for (let i = columns.length - 1; i >= 0; i--) {
    const col = columns[i]
    if (col.pinned === "right") {
      rightOffsets[col.id] = right
      right += widths[col.id]
    }
  }
  return { widths, totalWidth, leftOffsets, rightOffsets }
}

function columnLabel<T>(col: DataGridColumn<T>): string {
  return typeof col.header === "string" ? col.header : col.id
}

/* ------------------------------------------------------------------ */
/* Header cell                                                         */
/* ------------------------------------------------------------------ */

function GridColumnHeader<T>({
  column,
  sorting,
  onToggleSort,
  showFilter,
  filterValue,
  onFilterChange,
  width,
  leftOffset,
  rightOffset,
  resizable,
  onResizeStart,
  onResizeNudge,
}: {
  column: DataGridColumn<T>
  sorting: SortState | null
  onToggleSort: (key: string) => void
  showFilter: boolean
  filterValue: string
  onFilterChange: (value: string) => void
  width: number
  leftOffset: number | undefined
  rightOffset: number | undefined
  resizable: boolean
  onResizeStart: (startX: number, startWidth: number) => void
  onResizeNudge: (delta: number) => void
}) {
  const sortable = Boolean(column.sortValue)
  const active = sorting?.key === column.id ? sorting.direction : null
  const label = columnLabel(column)

  return (
    <div
      role="columnheader"
      aria-sort={
        sortable
          ? active === "asc"
            ? "ascending"
            : active === "desc"
              ? "descending"
              : "none"
          : undefined
      }
      className={cn(
        "border-border/60 relative flex h-full shrink-0 flex-col justify-center border-r px-3",
        alignClass[column.align ?? "left"],
        column.pinned && "bg-background sticky z-20",
        column.headClassName,
      )}
      style={{
        width,
        minWidth: width,
        ...(leftOffset != null ? { left: leftOffset } : {}),
        ...(rightOffset != null ? { right: rightOffset } : {}),
      }}
    >
      <div className="flex items-center gap-1">
        {sortable ? (
          <button
            type="button"
            onClick={() => onToggleSort(column.id)}
            className="hover:text-foreground/80 focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            {column.header}
            {active === "asc" ? (
              <ArrowUpIcon className="size-3.5" />
            ) : active === "desc" ? (
              <ArrowDownIcon className="size-3.5" />
            ) : (
              <ArrowUpDownIcon className="size-3.5 opacity-40" />
            )}
          </button>
        ) : (
          <span className="truncate font-medium">{column.header}</span>
        )}
      </div>
      {showFilter && column.filterValue !== undefined && (
        <Input
          type="search"
          value={filterValue}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={`Filter ${label}…`}
          aria-label={`Filter by ${label}`}
          className="mt-1 h-6 px-1.5 text-xs"
        />
      )}
      {resizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label} column`}
          className="hover:bg-ring/40 focus-visible:bg-ring/60 absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none focus-visible:outline-none"
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault()
            onResizeStart(e.clientX, width)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault()
              onResizeNudge(-16)
            } else if (e.key === "ArrowRight") {
              e.preventDefault()
              onResizeNudge(16)
            }
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DataGrid                                                            */
/* ------------------------------------------------------------------ */

function DataGrid<T>({
  rows,
  columns,
  getRowId,
  rowHeight = DEFAULT_ROW_HEIGHT,
  height = DEFAULT_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  defaultColumnWidth = DEFAULT_COLUMN_WIDTH,
  resizable = true,
  storageKey,
  onColumnResize,
  sorting: sortingProp,
  onSortingChange,
  initialSorting = null,
  manualSorting = false,
  filters: filtersProp,
  onFiltersChange,
  initialFilters = {},
  manualFiltering = false,
  showColumnFilters = false,
  toolbar,
  selectionMode = "multi",
  selectedIds: selectedIdsProp,
  onSelectionChange,
  isRowSelectable,
  loading = false,
  loadingRows = 8,
  emptyState,
  onRowClick,
  "aria-label": ariaLabel = "Data grid",
  className,
}: DataGridProps<T>) {
  const selectable = selectionMode !== "none"

  /* ------------------------------ sorting ------------------------------ */
  const [sortingInternal, setSortingInternal] = React.useState<SortState | null>(initialSorting)
  const sorting = sortingProp !== undefined ? sortingProp : sortingInternal
  const setSorting = React.useCallback(
    (next: SortState | null) => {
      onSortingChange?.(next)
      if (sortingProp === undefined) setSortingInternal(next)
    },
    [onSortingChange, sortingProp],
  )
  const toggleSort = React.useCallback(
    (key: string) => {
      const col = columns.find((c) => c.id === key)
      if (!col?.sortValue) return
      setSorting(nextSortState(sorting, key))
    },
    [columns, sorting, setSorting],
  )

  /* ------------------------------ filtering ---------------------------- */
  const [filtersInternal, setFiltersInternal] = React.useState<FilterState>(initialFilters)
  const filters = filtersProp !== undefined ? filtersProp : filtersInternal
  const setFilterValue = React.useCallback(
    (columnId: string, value: string) => {
      const next = { ...filters, [columnId]: value }
      onFiltersChange?.(next)
      if (filtersProp === undefined) setFiltersInternal(next)
    },
    [filters, filtersProp, onFiltersChange],
  )

  /* --------------------------- processed rows --------------------------- */
  const processed = React.useMemo(() => {
    const filtered = manualFiltering ? rows : filterRows(rows, columns, filters)
    return manualSorting ? filtered : sortRows(filtered, columns, sorting)
  }, [rows, columns, filters, sorting, manualFiltering, manualSorting])

  /* ------------------------------ selection ----------------------------- */
  const [selectedInternal, setSelectedInternal] = React.useState<string[]>([])
  const selected = selectedIdsProp !== undefined ? selectedIdsProp : selectedInternal
  const setSelected = React.useCallback(
    (ids: string[]) => {
      onSelectionChange?.(ids)
      if (selectedIdsProp === undefined) setSelectedInternal(ids)
    },
    [onSelectionChange, selectedIdsProp],
  )

  const idOf = React.useCallback(
    (row: T, index: number) => getRowId?.(row, index) ?? String(index),
    [getRowId],
  )

  const orderedIds = React.useMemo(() => processed.map((row, i) => idOf(row, i)), [processed, idOf])
  const selectedSet = React.useMemo(() => new Set(selected), [selected])
  const lastSelectedIndexRef = React.useRef<number | null>(null)
  // Radix Checkbox's onCheckedChange doesn't expose the mouse event, so we
  // capture shiftKey during the click's capture phase.
  const shiftClickRef = React.useRef(false)

  const handleRowSelect = React.useCallback(
    (index: number, shiftKey: boolean) => {
      const row = processed[index]
      if (!row) return
      if (isRowSelectable && !isRowSelectable(row, index)) return
      const next = applyRowClickSelection(selected, orderedIds, index, {
        mode: selectionMode === "single" ? "single" : "multi",
        shiftKey,
        lastIndex: lastSelectedIndexRef.current,
      })
      lastSelectedIndexRef.current = index
      setSelected(next)
    },
    [processed, selected, orderedIds, selectionMode, isRowSelectable, setSelected],
  )

  const allDisplayedSelected =
    orderedIds.length > 0 && orderedIds.every((id) => selectedSet.has(id))
  const someDisplayedSelected = orderedIds.some((id) => selectedSet.has(id))
  const selectAllState: boolean | "indeterminate" = allDisplayedSelected
    ? true
    : someDisplayedSelected
      ? "indeterminate"
      : false

  const toggleSelectAll = React.useCallback(() => {
    setSelected(applySelectAll(selected, orderedIds))
  }, [selected, orderedIds, setSelected])

  /* --------------------------- column widths ---------------------------- */
  const [widthOverrides, setWidthOverrides] = React.useState<Record<string, number>>(() =>
    loadStoredWidths(storageKey),
  )

  const metrics = React.useMemo(
    () => computeColumnMetrics(columns, widthOverrides, defaultColumnWidth),
    [columns, widthOverrides, defaultColumnWidth],
  )

  const persistWidths = React.useCallback(
    (next: Record<string, number>) => {
      if (!storageKey || typeof window === "undefined") return
      try {
        window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next))
      } catch {
        /* storage unavailable */
      }
    },
    [storageKey],
  )

  const applyColumnWidth = React.useCallback(
    (column: DataGridColumn<T>, width: number) => {
      const clamped = clampWidth(
        width,
        column.minWidth ?? MIN_COLUMN_WIDTH,
        column.maxWidth ?? MAX_COLUMN_WIDTH,
      )
      setWidthOverrides((prev) => {
        const next = { ...prev, [column.id]: clamped }
        persistWidths(next)
        return next
      })
      onColumnResize?.(column.id, clamped)
    },
    [persistWidths, onColumnResize],
  )

  const resizeRef = React.useRef<{
    column: DataGridColumn<T>
    startX: number
    startWidth: number
  } | null>(null)

  const handleResizeStart = React.useCallback(
    (column: DataGridColumn<T>) => (startX: number, startWidth: number) => {
      resizeRef.current = { column, startX, startWidth }
      const onMove = (e: PointerEvent) => {
        const st = resizeRef.current
        if (!st) return
        applyColumnWidth(st.column, st.startWidth + (e.clientX - st.startX))
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [applyColumnWidth],
  )

  const handleResizeNudge = React.useCallback(
    (column: DataGridColumn<T>) => (delta: number) => {
      const current = widthOverrides[column.id] ?? resolveColumnWidth(column, defaultColumnWidth)
      applyColumnWidth(column, current + delta)
    },
    [widthOverrides, defaultColumnWidth, applyColumnWidth],
  )

  /* ------------------------------ scrolling ----------------------------- */
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(height)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const measured = el.clientHeight
      setViewportHeight(measured > 0 ? measured : height)
    }
    update()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  const bodyViewportHeight = Math.max(viewportHeight - HEADER_HEIGHT, rowHeight)

  const range = React.useMemo(
    () =>
      computeVirtualRange({
        count: processed.length,
        scrollTop,
        viewportHeight: bodyViewportHeight,
        rowHeight,
        overscan,
      }),
    [processed.length, scrollTop, bodyViewportHeight, rowHeight, overscan],
  )

  /* --------------------------- keyboard nav ------------------------------ */
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)

  const scrollRowIntoView = React.useCallback(
    (index: number) => {
      const el = scrollRef.current
      if (!el) return
      const rowTop = index * rowHeight
      const rowBottom = rowTop + rowHeight
      const viewTop = el.scrollTop
      const viewBottom = viewTop + bodyViewportHeight
      let next = el.scrollTop
      if (rowTop < viewTop) next = rowTop
      else if (rowBottom > viewBottom) next = rowBottom - bodyViewportHeight
      const max = Math.max(0, range.totalSize - bodyViewportHeight)
      const clamped = Math.min(Math.max(next, 0), max)
      if (clamped !== el.scrollTop) {
        el.scrollTop = clamped
        // Keep React state in sync — jsdom and some browsers don't always
        // dispatch a scroll event for programmatic scrollTop changes.
        setScrollTop(clamped)
      }
    },
    [rowHeight, bodyViewportHeight, range.totalSize],
  )

  const moveActive = React.useCallback(
    (next: number) => {
      if (processed.length === 0) return
      const clamped = Math.max(0, Math.min(processed.length - 1, next))
      setActiveIndex(clamped)
      scrollRowIntoView(clamped)
    },
    [processed.length, scrollRowIntoView],
  )

  const handleGridKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="separator"]')) {
        return
      }
      const count = processed.length
      if (count === 0) return
      const current = activeIndex ?? rowIndexAtScrollTop(scrollTop, rowHeight, count)
      const page = pageRowCount(bodyViewportHeight, rowHeight)
      const onInteractive = Boolean(target.closest('button, [role="checkbox"], a[href]'))

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          moveActive(current + 1)
          break
        case "ArrowUp":
          e.preventDefault()
          moveActive(current - 1)
          break
        case "Home":
          e.preventDefault()
          moveActive(0)
          break
        case "End":
          e.preventDefault()
          moveActive(count - 1)
          break
        case "PageDown":
          e.preventDefault()
          moveActive(current + page)
          break
        case "PageUp":
          e.preventDefault()
          moveActive(current - page)
          break
        case " ":
          if (onInteractive) return
          if (selectable && selectionMode === "multi") {
            e.preventDefault()
            handleRowSelect(current, e.shiftKey)
          }
          break
        case "Enter":
          if (onInteractive) return
          if (onRowClick) {
            e.preventDefault()
            onRowClick(processed[current])
          }
          break
        case "a":
        case "A":
          if ((e.ctrlKey || e.metaKey) && selectable && selectionMode === "multi") {
            e.preventDefault()
            toggleSelectAll()
          }
          break
      }
    },
    [
      processed,
      activeIndex,
      scrollTop,
      rowHeight,
      bodyViewportHeight,
      moveActive,
      selectable,
      selectionMode,
      handleRowSelect,
      onRowClick,
      toggleSelectAll,
    ],
  )

  /* ------------------------------ render -------------------------------- */
  const visibleRows = processed.slice(range.start, range.end)
  const colCount = columns.length + (selectable ? 1 : 0)
  const showHeader = columns.length > 0
  const hasFilters = columns.some((c) => showColumnFilters && c.filterValue !== undefined)

  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={processed.length + (showHeader ? 1 : 0)}
      aria-colcount={colCount}
      aria-busy={loading || undefined}
      onKeyDown={handleGridKeyDown}
      className={cn("flex flex-col gap-2", className)}
    >
      {toolbar}

      <div
        ref={scrollRef}
        data-slot="data-grid-viewport"
        className="bg-background relative overflow-auto rounded-md border"
        style={{ height }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {/* Sticky header */}
        {showHeader && (
          <div
            role="row"
            aria-rowindex={1}
            className="bg-background sticky top-0 z-30 flex border-b"
            style={{ height: HEADER_HEIGHT + (hasFilters ? 0 : 0), width: metrics.totalWidth }}
          >
            {selectable && (
              <div
                role="columnheader"
                aria-label="Selection"
                className="bg-background sticky left-0 z-40 flex w-10 shrink-0 items-center justify-center border-r px-2"
              >
                <Checkbox
                  checked={selectAllState}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all rows"
                />
              </div>
            )}
            {columns.map((col) => (
              <GridColumnHeader
                key={col.id}
                column={col}
                sorting={sorting}
                onToggleSort={toggleSort}
                showFilter={showColumnFilters}
                filterValue={filters[col.id] ?? ""}
                onFilterChange={(v) => setFilterValue(col.id, v)}
                width={metrics.widths[col.id]}
                leftOffset={metrics.leftOffsets[col.id]}
                rightOffset={metrics.rightOffsets[col.id]}
                resizable={resizable}
                onResizeStart={handleResizeStart(col)}
                onResizeNudge={handleResizeNudge(col)}
              />
            ))}
          </div>
        )}

        {/* Scrollable body */}
        <div
          role="presentation"
          style={{
            height: range.totalSize,
            position: "relative",
            width: metrics.totalWidth,
          }}
        >
          {loading ? (
            Array.from({ length: loadingRows }, (_, i) => (
              <div
                key={`skeleton-${i}`}
                aria-hidden="true"
                className="border-border/40 absolute left-0 flex items-center border-b px-3"
                style={{
                  top: i * rowHeight,
                  height: rowHeight,
                  width: metrics.totalWidth,
                }}
              >
                {selectable && <div className="bg-muted size-4 shrink-0 rounded" />}
                {columns.map((col) => (
                  <div
                    key={col.id}
                    className="bg-muted mx-1 h-4 animate-pulse rounded"
                    style={{ width: Math.max(metrics.widths[col.id] - 16, 24) }}
                  />
                ))}
              </div>
            ))
          ) : visibleRows.length === 0 ? (
            <div
              role="row"
              aria-rowindex={showHeader ? 2 : 1}
              className="text-muted-foreground absolute inset-x-0 flex items-center justify-center text-sm"
              style={{ top: 0, height: Math.max(rowHeight * 3, 96) }}
            >
              <div role="gridcell">{emptyState ?? "No results."}</div>
            </div>
          ) : (
            visibleRows.map((row, i) => {
              const index = range.start + i
              const id = orderedIds[index]
              const isSelected = selectedSet.has(id)
              const isActive = activeIndex === index
              return (
                <div
                  key={id}
                  role="row"
                  aria-rowindex={index + (showHeader ? 2 : 1)}
                  aria-selected={selectable ? isSelected : undefined}
                  tabIndex={isActive ? 0 : -1}
                  data-state={isSelected ? "selected" : undefined}
                  onFocus={() => setActiveIndex(index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-border/40 absolute left-0 flex border-b transition-colors",
                    "hover:bg-muted/50",
                    isSelected && "bg-muted",
                    isActive && "ring-ring/60 ring-1 outline-none ring-inset",
                    onRowClick && "cursor-pointer",
                  )}
                  style={{
                    top: index * rowHeight,
                    height: rowHeight,
                    width: metrics.totalWidth,
                  }}
                >
                  {selectable && (
                    <div
                      role="gridcell"
                      aria-colindex={1}
                      className="sticky left-0 z-10 flex w-10 shrink-0 items-center justify-center border-r bg-inherit px-2"
                      onClick={(e) => e.stopPropagation()}
                      onClickCapture={(e) => {
                        shiftClickRef.current = e.shiftKey
                      }}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleRowSelect(index, shiftClickRef.current)}
                        aria-label={`Select row ${index + 1}`}
                      />
                    </div>
                  )}
                  {columns.map((col, ci) => (
                    <div
                      key={col.id}
                      role="gridcell"
                      aria-colindex={ci + (selectable ? 2 : 1)}
                      className={cn(
                        "flex shrink-0 items-center overflow-hidden px-3",
                        alignClass[col.align ?? "left"],
                        col.pinned && "sticky z-10 bg-inherit",
                        col.className,
                      )}
                      style={{
                        width: metrics.widths[col.id],
                        minWidth: metrics.widths[col.id],
                        ...(metrics.leftOffsets[col.id] != null
                          ? { left: metrics.leftOffsets[col.id] }
                          : {}),
                        ...(metrics.rightOffsets[col.id] != null
                          ? { right: metrics.rightOffsets[col.id] }
                          : {}),
                      }}
                    >
                      {col.cell(row)}
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {sorting
          ? `Sorted by ${sorting.key} ${sorting.direction === "asc" ? "ascending" : "descending"}`
          : ""}
      </div>
    </div>
  )
}

export { DataGrid }
