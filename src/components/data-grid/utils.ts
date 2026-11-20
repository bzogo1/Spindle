import type { DataGridColumn, FilterState, SortState, SortValue, VirtualRange } from "./types"

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

/** Cycles asc -> desc -> null for a column. */
export function nextSortState(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "asc" }
  if (current.direction === "asc") return { key, direction: "desc" }
  return null
}

export function compareSortValues(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** Returns a new sorted array. Does not mutate `rows`. */
export function sortRows<T>(
  rows: T[],
  columns: DataGridColumn<T>[],
  sorting: SortState | null,
): T[] {
  if (!sorting) return rows
  const col = columns.find((c) => c.id === sorting.key)
  if (!col?.sortValue) return rows
  const dir = sorting.direction === "asc" ? 1 : -1
  return [...rows].sort((a, b) => compareSortValues(col.sortValue!(a), col.sortValue!(b)) * dir)
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

/** Applies per-column substring filters. Columns without `filterValue` are ignored. */
export function filterRows<T>(rows: T[], columns: DataGridColumn<T>[], filters: FilterState): T[] {
  const active = columns.filter((c) => c.filterValue && (filters[c.id] ?? "").trim() !== "")
  if (active.length === 0) return rows
  const queries = active.map((c) => ({
    value: c.filterValue!,
    query: filters[c.id]!.trim().toLowerCase(),
  }))
  return rows.filter((row) =>
    queries.every(({ value, query }) =>
      String(value(row) ?? "")
        .toLowerCase()
        .includes(query),
    ),
  )
}

/* ------------------------------------------------------------------ */
/* Virtualization                                                      */
/* ------------------------------------------------------------------ */

export interface VirtualRangeInput {
  /** Total number of rows. */
  count: number
  /** Current scrollTop of the viewport in px. */
  scrollTop: number
  /** Viewport height in px. */
  viewportHeight: number
  /** Fixed height of each row in px. */
  rowHeight: number
  /** Extra rows rendered above/below the visible window. */
  overscan: number
}

/**
 * Computes which rows must be mounted for a given scroll position.
 * Pure and layout-independent so it can be unit-tested in jsdom.
 */
export function computeVirtualRange({
  count,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
}: VirtualRangeInput): VirtualRange {
  if (count <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, totalSize: 0, offsetTop: 0 }
  }
  const totalSize = count * rowHeight
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight))
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight))
  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(count, firstVisible + visibleCount + overscan)
  return {
    start,
    end,
    totalSize,
    offsetTop: start * rowHeight,
  }
}

/** Index of the row at a scroll position (clamped to [0, count-1]). */
export function rowIndexAtScrollTop(scrollTop: number, rowHeight: number, count: number): number {
  if (count <= 0 || rowHeight <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.floor(scrollTop / rowHeight)))
}

/** Scroll offset needed to bring a row fully into view. */
export function scrollTopForIndex(
  index: number,
  rowHeight: number,
  viewportHeight: number,
): number {
  const clamped = Math.max(0, index)
  // If the row is already fully visible, keep the current scroll — the
  // caller compares against current scrollTop before applying.
  void viewportHeight
  return clamped * rowHeight
}

/** Number of rows that fit in the viewport (PageUp/PageDown step). */
export function pageRowCount(viewportHeight: number, rowHeight: number): number {
  if (rowHeight <= 0) return 1
  return Math.max(1, Math.floor(viewportHeight / rowHeight))
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
}

/**
 * Computes the selection resulting from a click.
 * - multi mode + shiftKey: selects the inclusive range between
 *   `lastIndex` and `index` (positions in the *displayed* row order),
 *   preserving existing selections outside the range.
 * - multi mode: toggles `id`.
 * - single mode: replaces selection with `[id]` (or `[]` if deselected).
 */
export function applyRowClickSelection(
  selectedIds: string[],
  orderedIds: string[],
  index: number,
  options: { mode: "single" | "multi"; shiftKey: boolean; lastIndex: number | null },
): string[] {
  const id = orderedIds[index]
  if (id == null) return selectedIds

  if (options.mode === "single") {
    return selectedIds.includes(id) ? [] : [id]
  }

  if (options.shiftKey && options.lastIndex != null) {
    const from = Math.min(options.lastIndex, index)
    const to = Math.max(options.lastIndex, index)
    const range = orderedIds.slice(from, to + 1)
    // Selecting a range always selects (does not toggle).
    return [...new Set([...selectedIds, ...range])]
  }

  return toggleId(selectedIds, id)
}

/** Select-all / deselect-all over the currently displayed rows. */
export function applySelectAll(selectedIds: string[], displayedIds: string[]): string[] {
  const displayed = new Set(displayedIds)
  const allSelected =
    displayedIds.length > 0 && displayedIds.every((id) => selectedIds.includes(id))
  if (allSelected) {
    return selectedIds.filter((id) => !displayed.has(id))
  }
  return [...new Set([...selectedIds, ...displayedIds])]
}

/* ------------------------------------------------------------------ */
/* Column widths                                                       */
/* ------------------------------------------------------------------ */

export function clampWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(width)))
}

export function resolveColumnWidth<T>(col: DataGridColumn<T>, fallback: number): number {
  return col.width ?? fallback
}
