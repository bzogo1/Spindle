"use client"

import { useMemo, useState } from "react"

type SortKey = "site" | "salinity" | "turbidity" | "temp"
type SortDirection = "asc" | "desc"

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "site", label: "site", numeric: false },
  { key: "salinity", label: "salinity", numeric: true },
  { key: "turbidity", label: "turbidity", numeric: true },
  { key: "temp", label: "temp", numeric: true },
]

/** groupby('site').mean() output for the coastal-resilience survey. */
const ROWS: Record<SortKey, string | number>[] = [
  { site: "A-01", salinity: 28.4, turbidity: 12.6, temp: 14.2 },
  { site: "A-02", salinity: 27.9, turbidity: 15.1, temp: 14.8 },
  { site: "B-04", salinity: 31.2, turbidity: 9.8, temp: 15.6 },
  { site: "C-07", salinity: 29.6, turbidity: 18.3, temp: 13.9 },
]

const ARIA_SORT = {
  none: "none",
  asc: "ascending",
  desc: "descending",
} as const

/**
 * Notebook cell output rendered as a real, sortable table: clicking a column
 * header toggles ascending/descending order and exposes the state via
 * `aria-sort` on the header cell.
 */
export function LabNotebookTable() {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [direction, setDirection] = useState<SortDirection>("asc")

  const rows = useMemo(() => {
    if (!sortKey) return ROWS
    const factor = direction === "asc" ? 1 : -1
    return [...ROWS].sort((a, b) => {
      const left = a[sortKey]
      const right = b[sortKey]
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * factor
      }
      return String(left).localeCompare(String(right)) * factor
    })
  }, [sortKey, direction])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setDirection("asc")
    }
  }

  return (
    <table className="notebook-table">
      <thead>
        <tr>
          {COLUMNS.map((column) => {
            const active = sortKey === column.key
            return (
              <th
                key={column.key}
                scope="col"
                aria-sort={active ? ARIA_SORT[direction] : ARIA_SORT.none}
              >
                <button
                  type="button"
                  className="notebook-table-sort"
                  onClick={() => toggleSort(column.key)}
                  aria-label={`Sort by ${column.label}`}
                >
                  {column.label}
                  <span className="notebook-table-arrow" aria-hidden="true">
                    {active ? (direction === "asc" ? "▲" : "▼") : "↕"}
                  </span>
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.site)}>
            {COLUMNS.map((column) => (
              <td key={column.key} className={column.numeric ? "is-num" : undefined}>
                {row[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
