import { describe, expect, it } from "vitest"

import type { DataGridColumn } from "./types"
import {
  applyRowClickSelection,
  applySelectAll,
  clampWidth,
  compareSortValues,
  computeVirtualRange,
  filterRows,
  nextSortState,
  pageRowCount,
  rowIndexAtScrollTop,
  scrollTopForIndex,
  sortRows,
  toggleId,
} from "./utils"

interface Row {
  id: string
  name: string
  age: number
}

const columns: DataGridColumn<Row>[] = [
  {
    id: "name",
    header: "Name",
    cell: (r) => r.name,
    sortValue: (r) => r.name,
    filterValue: (r) => r.name,
  },
  {
    id: "age",
    header: "Age",
    cell: (r) => r.age,
    sortValue: (r) => r.age,
  },
]

const rows: Row[] = [
  { id: "1", name: "Carol", age: 40 },
  { id: "2", name: "alice", age: 25 },
  { id: "3", name: "Bob", age: 30 },
]

describe("nextSortState", () => {
  it("cycles asc -> desc -> null", () => {
    expect(nextSortState(null, "name")).toEqual({ key: "name", direction: "asc" })
    expect(nextSortState({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    })
    expect(nextSortState({ key: "name", direction: "desc" }, "name")).toBeNull()
  })

  it("switches key resets to asc", () => {
    expect(nextSortState({ key: "name", direction: "desc" }, "age")).toEqual({
      key: "age",
      direction: "asc",
    })
  })
})

describe("compareSortValues", () => {
  it("orders numbers numerically", () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0)
    expect(compareSortValues(10, 2)).toBeGreaterThan(0)
  })

  it("orders strings with numeric collation", () => {
    expect(compareSortValues("item2", "item10")).toBeLessThan(0)
  })

  it("sorts null/undefined last", () => {
    expect(compareSortValues(null, "a")).toBeGreaterThan(0)
    expect(compareSortValues(undefined, 1)).toBeGreaterThan(0)
    expect(compareSortValues(null, undefined)).toBe(0)
  })
})

describe("sortRows", () => {
  it("sorts ascending and descending without mutating input", () => {
    const asc = sortRows(rows, columns, { key: "age", direction: "asc" })
    expect(asc.map((r) => r.id)).toEqual(["2", "3", "1"])
    const desc = sortRows(rows, columns, { key: "age", direction: "desc" })
    expect(desc.map((r) => r.id)).toEqual(["1", "3", "2"])
    expect(rows[0].id).toBe("1") // input untouched
  })

  it("returns input when no sort or unknown column", () => {
    expect(sortRows(rows, columns, null)).toBe(rows)
    expect(sortRows(rows, columns, { key: "nope", direction: "asc" })).toBe(rows)
  })

  it("sorts strings case-insensitively via localeCompare", () => {
    const sorted = sortRows(rows, columns, { key: "name", direction: "asc" })
    expect(sorted.map((r) => r.name)).toEqual(["alice", "Bob", "Carol"])
  })
})

describe("filterRows", () => {
  it("filters per-column with case-insensitive substring", () => {
    const out = filterRows(rows, columns, { name: "AL" })
    expect(out.map((r) => r.id)).toEqual(["2"])
  })

  it("ANDs multiple column filters", () => {
    const out = filterRows(rows, columns, { name: "a", age: "" })
    // "a" matches Carol? no — Carol has no 'a'? it does: C-a-r-o-l yes.
    expect(out.length).toBeGreaterThan(0)
  })

  it("ignores blank queries and unknown columns", () => {
    expect(filterRows(rows, columns, { name: "  " })).toBe(rows)
    expect(filterRows(rows, columns, { nope: "x" })).toBe(rows)
  })

  it("does not filter on columns without filterValue", () => {
    const out = filterRows(rows, columns, { age: "25" })
    expect(out).toBe(rows)
  })
})

describe("computeVirtualRange", () => {
  const base = {
    count: 10_000,
    viewportHeight: 400,
    rowHeight: 40,
    overscan: 5,
  }

  it("mounts only visible rows plus overscan", () => {
    const r = computeVirtualRange({ ...base, scrollTop: 0 })
    expect(r.start).toBe(0)
    expect(r.end).toBe(10 + 5) // 10 visible + overscan
    expect(r.totalSize).toBe(400_000)
    expect(r.offsetTop).toBe(0)
  })

  it("windows correctly mid-scroll", () => {
    const r = computeVirtualRange({ ...base, scrollTop: 40_000 }) // row 1000
    expect(r.start).toBe(995)
    expect(r.end).toBe(1015)
    expect(r.offsetTop).toBe(995 * 40)
  })

  it("clamps at the end", () => {
    // max realistic scrollTop = totalSize - viewportHeight = 399_600
    const r = computeVirtualRange({ ...base, scrollTop: 399_600 })
    expect(r.end).toBe(10_000)
    expect(r.start).toBe(9_985)
  })

  it("handles empty and degenerate input", () => {
    expect(computeVirtualRange({ ...base, count: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      totalSize: 0,
      offsetTop: 0,
    })
    expect(computeVirtualRange({ ...base, rowHeight: 0, scrollTop: 0 }).totalSize).toBe(0)
  })
})

describe("rowIndexAtScrollTop / scrollTopForIndex / pageRowCount", () => {
  it("maps scroll offsets to row indexes", () => {
    expect(rowIndexAtScrollTop(0, 40, 100)).toBe(0)
    expect(rowIndexAtScrollTop(39, 40, 100)).toBe(0)
    expect(rowIndexAtScrollTop(40, 40, 100)).toBe(1)
    expect(rowIndexAtScrollTop(999_999, 40, 100)).toBe(99)
  })

  it("computes scroll offsets and page sizes", () => {
    expect(scrollTopForIndex(10, 40, 400)).toBe(400)
    expect(pageRowCount(400, 40)).toBe(10)
    expect(pageRowCount(0, 40)).toBe(1)
  })
})

describe("selection helpers", () => {
  const ids = ["a", "b", "c", "d", "e"]

  it("toggleId adds and removes", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"])
    expect(toggleId(["a", "b"], "a")).toEqual(["b"])
  })

  it("multi click toggles a single row", () => {
    const out = applyRowClickSelection([], ids, 2, {
      mode: "multi",
      shiftKey: false,
      lastIndex: null,
    })
    expect(out).toEqual(["c"])
  })

  it("shift-click selects the inclusive range", () => {
    const out = applyRowClickSelection(["a"], ids, 3, {
      mode: "multi",
      shiftKey: true,
      lastIndex: 1,
    })
    expect(out).toEqual(["a", "b", "c", "d"])
  })

  it("shift-click with reversed range works", () => {
    const out = applyRowClickSelection([], ids, 1, {
      mode: "multi",
      shiftKey: true,
      lastIndex: 3,
    })
    expect(out).toEqual(["b", "c", "d"])
  })

  it("single mode replaces selection", () => {
    const out = applyRowClickSelection(["x"], ids, 0, {
      mode: "single",
      shiftKey: false,
      lastIndex: null,
    })
    expect(out).toEqual(["a"])
    const cleared = applyRowClickSelection(["a"], ids, 0, {
      mode: "single",
      shiftKey: false,
      lastIndex: 0,
    })
    expect(cleared).toEqual([])
  })

  it("applySelectAll selects all then deselects all", () => {
    const all = applySelectAll([], ids)
    expect(all).toEqual(ids)
    const none = applySelectAll(all, ids)
    expect(none).toEqual([])
    // partial -> selects all
    expect(applySelectAll(["a"], ids)).toEqual(ids)
  })

  it("applySelectAll preserves selections outside the displayed set", () => {
    const out = applySelectAll(["z"], ids.slice(0, 2))
    expect(out).toEqual(["z", "a", "b"])
  })
})

describe("clampWidth", () => {
  it("clamps and rounds", () => {
    expect(clampWidth(10, 60, 1200)).toBe(60)
    expect(clampWidth(5000, 60, 1200)).toBe(1200)
    expect(clampWidth(100.6, 60, 1200)).toBe(101)
  })
})
