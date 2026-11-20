import * as React from "react"

export type SortDirection = "asc" | "desc"

export interface SortState {
  key: string
  direction: SortDirection
}

export type SortValue = string | number | null | undefined

/** Per-column filter state: column id -> free-text query. */
export type FilterState = Record<string, string>

export type PinnedSide = "left" | "right"

export interface DataGridColumn<T> {
  /** Unique column id — also used as the sort key and filter key. */
  id: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => SortValue
  /**
   * Provide to make the column filterable. The returned text is matched
   * (case-insensitive substring) against the column's filter query.
   */
  filterValue?: (row: T) => string
  /** Initial/preferred width in px. Defaults to `defaultColumnWidth`. */
  width?: number
  minWidth?: number
  maxWidth?: number
  /** Pin the column while scrolling horizontally. */
  pinned?: PinnedSide
  align?: "left" | "center" | "right"
  className?: string
  headClassName?: string
}

export type SelectionMode = "single" | "multi"

export interface VirtualRange {
  /** Index of the first rendered row (inclusive). */
  start: number
  /** Index of the last rendered row (exclusive). */
  end: number
  /** Total scrollable content height in px. */
  totalSize: number
  /** px offset where the first rendered row should be placed. */
  offsetTop: number
}

export interface DataGridProps<T> {
  rows: T[]
  columns: DataGridColumn<T>[]
  /** Stable row id used for selection + React keys. Defaults to row index. */
  getRowId?: (row: T, index: number) => string

  /* ------------------------------ sizing ------------------------------ */
  /** Fixed row height in px. The grid is optimized for fixed-height rows. */
  rowHeight?: number
  /** Viewport height in px. Defaults to 480. */
  height?: number
  /** Extra rows rendered above/below the visible window. Defaults to 8. */
  overscan?: number
  /** Default column width when a column doesn't specify one. */
  defaultColumnWidth?: number
  /** Show a resize handle on each column header. */
  resizable?: boolean
  /**
   * Persist column widths to localStorage under this key.
   * Only applied on the client; ignored during SSR/tests without storage.
   */
  storageKey?: string
  /** Called after a column is resized (id, new width). */
  onColumnResize?: (columnId: string, width: number) => void

  /* ------------------------------ sorting ------------------------------ */
  /** Controlled sort state. Pass `null` for unsorted. */
  sorting?: SortState | null
  /** Called with the next sort state (or `null` when sorting is cleared). */
  onSortingChange?: (sorting: SortState | null) => void
  /** Initial sort state for uncontrolled usage. */
  initialSorting?: SortState | null
  /**
   * When true, `rows` are treated as already sorted and the grid does not
   * re-sort them (server-side sorting mode). `onSortingChange` still fires.
   */
  manualSorting?: boolean

  /* ------------------------------ filtering ---------------------------- */
  /**
   * Controlled filter state: `{ [columnId]: query }`. Only columns with
   * `filterValue` participate. Controlled or uncontrolled.
   */
  filters?: FilterState
  onFiltersChange?: (filters: FilterState) => void
  /** Initial filters for uncontrolled usage. */
  initialFilters?: FilterState
  /**
   * When true, `rows` are treated as already filtered (server-side mode)
   * and the grid does not apply filters itself.
   */
  manualFiltering?: boolean
  /** Render a filter input inside each filterable column header. */
  showColumnFilters?: boolean
  /** Optional toolbar slot rendered above the grid. */
  toolbar?: React.ReactNode

  /* ------------------------------ selection ---------------------------- */
  /** "single" | "multi" enables selection; "none" hides the selection column. */
  selectionMode?: SelectionMode | "none"
  /** Controlled selection state (row ids). */
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  /** Disable selection for specific rows. */
  isRowSelectable?: (row: T, index: number) => boolean

  /* ------------------------------ states -------------------------------- */
  loading?: boolean
  /** Number of skeleton rows while `loading`. Defaults to 8. */
  loadingRows?: number
  emptyState?: React.ReactNode
  onRowClick?: (row: T) => void

  /** Accessible label for the grid. */
  "aria-label"?: string
  className?: string
}
