"use client"

/**
 * Demo usage — NOT wired into any route.
 *
 * ```tsx
 * import { DataGrid, type DataGridColumn } from "@/components/data-grid"
 *
 * interface FileRow {
 *   id: string
 *   name: string
 *   size: number
 *   modified: string
 * }
 *
 * const columns: DataGridColumn<FileRow>[] = [
 *   {
 *     id: "name",
 *     header: "Name",
 *     pinned: "left",
 *     sortValue: (r) => r.name,
 *     filterValue: (r) => r.name,
 *     cell: (r) => <span className="font-medium">{r.name}</span>,
 *   },
 *   {
 *     id: "size",
 *     header: "Size",
 *     width: 120,
 *     align: "right",
 *     sortValue: (r) => r.size,
 *     cell: (r) => `${(r.size / 1024).toFixed(1)} KB`,
 *   },
 *   {
 *     id: "modified",
 *     header: "Modified",
 *     sortValue: (r) => r.modified,
 *     cell: (r) => r.modified,
 *   },
 * ]
 *
 * // Client-side mode (default): grid sorts/filters `rows` itself.
 * <DataGrid
 *   rows={files}
 *   columns={columns}
 *   getRowId={(r) => r.id}
 *   height={520}
 *   rowHeight={44}
 *   showColumnFilters
 *   storageKey="files-grid"
 *   onRowClick={(row) => openPreview(row)}
 * />
 *
 * // Server-side mode: pass manualSorting/manualFiltering and feed the
 * // already-processed page of rows; react to onSortingChange/onFiltersChange
 * // to refetch.
 * <DataGrid
 *   rows={serverRows}
 *   columns={columns}
 *   manualSorting
 *   manualFiltering
 *   sorting={sort}
 *   onSortingChange={setSort}
 *   filters={filters}
 *   onFiltersChange={setFilters}
 *   selectedIds={selected}
 *   onSelectionChange={setSelected}
 * />
 * ```
 */
export {}
