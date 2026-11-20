import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DataGrid, type DataGridColumn } from "./index"

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

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    name: `Person ${String(i).padStart(4, "0")}`,
    age: (i * 7) % 90,
  }))
}

const smallData: Row[] = [
  { id: "1", name: "Alice", age: 30 },
  { id: "2", name: "Bob", age: 25 },
  { id: "3", name: "Carol", age: 40 },
]

function setup(props: Partial<Parameters<typeof DataGrid<Row>>[0]> = {}, data: Row[] = smallData) {
  return render(
    <DataGrid<Row>
      rows={data}
      columns={columns}
      getRowId={(r) => r.id}
      height={200}
      overscan={2}
      {...props}
    />,
  )
}

describe("DataGrid rendering", () => {
  it("renders header and rows with grid semantics", () => {
    setup()
    const grid = screen.getByRole("grid", { name: "Data grid" })
    expect(grid).toHaveAttribute("aria-rowcount", "4") // header + 3 rows
    expect(grid).toHaveAttribute("aria-colcount", "3") // select + 2 cols
    expect(screen.getByRole("columnheader", { name: /Name/ })).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(4)
  })

  it("shows empty state when there are no rows", () => {
    setup({ emptyState: <span>Nothing here</span> }, [])
    expect(screen.getByText("Nothing here")).toBeInTheDocument()
  })

  it("renders skeleton rows while loading", () => {
    const { container } = setup({ loading: true, loadingRows: 4 })
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
    expect(screen.queryByText("Alice")).not.toBeInTheDocument()
  })
})

describe("sorting", () => {
  it("sorts ascending then descending then clears on header click", async () => {
    const user = userEvent.setup()
    setup()
    const nameHeader = screen.getByRole("button", { name: /Name/ })

    await user.click(nameHeader)
    let cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("gridcell")[1].textContent)
    expect(cells).toEqual(["Alice", "Bob", "Carol"])
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    )

    await user.click(nameHeader)
    cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("gridcell")[1].textContent)
    expect(cells).toEqual(["Carol", "Bob", "Alice"])
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    )

    await user.click(nameHeader)
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none")
  })

  it("respects controlled sorting and manualSorting", () => {
    const onSortingChange = vi.fn()
    setup({ sorting: { key: "age", direction: "desc" }, onSortingChange })
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("gridcell")[2].textContent)
    expect(cells).toEqual(["40", "30", "25"])
  })

  it("does not re-sort rows when manualSorting is set", () => {
    const reversed = [...smallData].reverse()
    setup(
      {
        sorting: { key: "age", direction: "asc" },
        manualSorting: true,
      },
      reversed,
    )
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("gridcell")[1].textContent)
    // manual mode preserves the given order
    expect(cells).toEqual(["Carol", "Bob", "Alice"])
  })
})

describe("filtering", () => {
  it("filters rows via header filter inputs", async () => {
    const user = userEvent.setup()
    setup({ showColumnFilters: true })
    const input = screen.getByRole("searchbox", { name: "Filter by Name" })
    await user.type(input, "ali")
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent("Alice")
  })

  it("supports controlled filters and manualFiltering", () => {
    setup({ filters: { name: "bob" }, manualFiltering: true })
    // manualFiltering: grid does not apply the filter itself
    expect(screen.getAllByRole("row")).toHaveLength(4)
  })
})

describe("selection", () => {
  it("toggles a row via its checkbox", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    setup({ onSelectionChange })
    const boxes = screen.getAllByRole("checkbox")
    await user.click(boxes[1]) // first data row (0 is select-all)
    expect(onSelectionChange).toHaveBeenLastCalledWith(["1"])
    expect(boxes[1]).toHaveAttribute("aria-checked", "true")
  })

  it("select-all toggles every displayed row", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    setup({ onSelectionChange })
    const selectAll = screen.getByRole("checkbox", { name: "Select all rows" })
    await user.click(selectAll)
    expect(onSelectionChange).toHaveBeenLastCalledWith(["1", "2", "3"])
    await user.click(selectAll)
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })

  it("single selection mode replaces selection", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    setup({ selectionMode: "single", onSelectionChange })
    const boxes = screen.getAllByRole("checkbox")
    await user.click(boxes[1])
    await user.click(boxes[2])
    expect(onSelectionChange).toHaveBeenLastCalledWith(["2"])
  })

  it("shift-click selects a range in displayed order", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    setup({ onSelectionChange }, makeRows(6))
    const boxes = screen.getAllByRole("checkbox")
    await user.click(boxes[1]) // row 0
    // user-event doesn't forward modifier keys on click(); use fireEvent.
    fireEvent.click(boxes[3], { shiftKey: true }) // row 2
    expect(onSelectionChange).toHaveBeenLastCalledWith(["r0", "r1", "r2"])
  })
})

describe("keyboard navigation", () => {
  it("arrow keys move the active row and space selects", () => {
    const onSelectionChange = vi.fn()
    setup({ onSelectionChange })
    const grid = screen.getByRole("grid")

    fireEvent.keyDown(grid, { key: "ArrowDown" })
    fireEvent.keyDown(grid, { key: "ArrowDown" })
    fireEvent.keyDown(grid, { key: " " })

    // two ArrowDowns from row 0 -> active row index 2 (Carol, id "3")
    expect(onSelectionChange).toHaveBeenLastCalledWith(["3"])
    const rows = screen.getAllByRole("row")
    expect(rows[3]).toHaveAttribute("aria-rowindex", "4")
    // active row is focusable
    expect(document.querySelector('[role="row"][tabindex="0"]')).toHaveTextContent("Carol")
  })

  it("Home/End/PageUp/PageDown navigate", () => {
    const data = makeRows(100)
    setup({}, data)
    const grid = screen.getByRole("grid")
    fireEvent.keyDown(grid, { key: "End" })
    fireEvent.keyDown(grid, { key: "PageUp" })
    const active = document.querySelector('[role="row"][tabindex="0"]')
    expect(active).not.toBeNull()
    fireEvent.keyDown(grid, { key: "Home" })
    const first = document.querySelector('[role="row"][tabindex="0"]')
    expect(first).toHaveTextContent("Person 0000")
  })

  it("ignores keys typed inside inputs", async () => {
    const user = userEvent.setup()
    setup({ showColumnFilters: true })
    const input = screen.getByRole("searchbox", { name: "Filter by Name" })
    await user.click(input)
    await user.keyboard("{ArrowDown}{End}")
    // no crash; grid rows unaffected by input caret keys
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1)
  })
})

describe("virtualization", () => {
  it("mounts only a window of rows for large datasets", () => {
    const data = makeRows(5_000)
    const { container } = setup({ height: 160, overscan: 3 }, data)
    const renderedRows = container.querySelectorAll('[role="row"]')
    // header + small window << 5000
    expect(renderedRows.length).toBeLessThan(50)
    expect(renderedRows.length).toBeGreaterThan(2)
  })

  it("renders different rows after scrolling", () => {
    const data = makeRows(1_000)
    const { container } = setup({ height: 160, overscan: 2 }, data)
    const viewport = container.querySelector('[data-slot="data-grid-viewport"]') as HTMLElement
    const before = Array.from(container.querySelectorAll('[role="row"]')).map((r) => r.textContent)

    fireEvent.scroll(viewport, { target: { scrollTop: 16_000 } })

    const after = Array.from(container.querySelectorAll('[role="row"]')).map((r) => r.textContent)
    expect(after).not.toEqual(before)
    // scrollTop 16000 / rowHeight 40 -> first visible row is index 400
    expect(after.some((t) => t?.includes("Person 0398"))).toBe(true)
    expect(after.some((t) => t?.includes("Person 0000"))).toBe(false)
  })

  it("scrolls active row into view on End key", () => {
    const data = makeRows(1_000)
    const { container } = setup({ height: 160, overscan: 2 }, data)
    const viewport = container.querySelector('[data-slot="data-grid-viewport"]') as HTMLElement
    fireEvent.keyDown(screen.getByRole("grid"), { key: "End" })
    expect(viewport.scrollTop).toBeGreaterThan(0)
  })
})

describe("column resizing", () => {
  it("resizes via keyboard on the separator", async () => {
    const user = userEvent.setup()
    const onColumnResize = vi.fn()
    setup({ onColumnResize, resizable: true })
    const separator = screen.getByRole("separator", {
      name: "Resize Name column",
    })
    separator.focus()
    await user.keyboard("{ArrowRight}")
    expect(onColumnResize).toHaveBeenCalledWith("name", 176) // 160 + 16
  })

  it("hides resize handles when resizable=false", () => {
    setup({ resizable: false })
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
  })
})
