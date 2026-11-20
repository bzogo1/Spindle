import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DataTable, type DataTableColumn } from "./table"

interface Row {
  id: string
  name: string
  age: number
}

const columns: DataTableColumn<Row>[] = [
  {
    id: "name",
    header: "Name",
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    filterText: (row) => row.name,
  },
  {
    id: "age",
    header: "Age",
    cell: (row) => row.age,
    sortValue: (row) => row.age,
    filterText: (row) => String(row.age),
  },
]

const data: Row[] = [
  { id: "1", name: "Alice", age: 30 },
  { id: "2", name: "Bob", age: 25 },
  { id: "3", name: "Carol", age: 40 },
]

function setup(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable<Row>
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      pagination={false}
      {...props}
    />,
  )
}

describe("DataTable sorting", () => {
  it("sorts ascending then descending then clears on repeated header clicks", async () => {
    const user = userEvent.setup()
    setup()

    const nameHeader = screen.getByRole("columnheader", { name: /name/i })
    const sortButton = within(nameHeader).getByRole("button")

    await user.click(sortButton)
    let cells = screen.getAllByRole("cell").map((c) => c.textContent)
    expect(cells).toEqual(["Alice", "30", "Bob", "25", "Carol", "40"])
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending")

    await user.click(sortButton)
    cells = screen.getAllByRole("cell").map((c) => c.textContent)
    expect(cells).toEqual(["Carol", "40", "Bob", "25", "Alice", "30"])
    expect(nameHeader).toHaveAttribute("aria-sort", "descending")

    await user.click(sortButton)
    cells = screen.getAllByRole("cell").map((c) => c.textContent)
    expect(cells).toEqual(["Alice", "30", "Bob", "25", "Carol", "40"])
    expect(nameHeader).toHaveAttribute("aria-sort", "none")
  })

  it("supports controlled sorting", async () => {
    const user = userEvent.setup()
    const onSortingChange = vi.fn()
    const { rerender } = render(
      <DataTable<Row>
        data={data}
        columns={columns}
        pagination={false}
        sorting={null}
        onSortingChange={onSortingChange}
      />,
    )

    await user.click(
      within(screen.getByRole("columnheader", { name: /name/i })).getByRole("button"),
    )
    expect(onSortingChange).toHaveBeenCalledWith({ key: "name", direction: "asc" })

    rerender(
      <DataTable<Row>
        data={data}
        columns={columns}
        pagination={false}
        sorting={{ key: "name", direction: "asc" }}
        onSortingChange={onSortingChange}
      />,
    )
    const firstCell = screen.getAllByRole("cell")[0]
    expect(firstCell).toHaveTextContent("Alice")
  })
})

describe("DataTable pagination", () => {
  const manyRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    name: `Person ${i}`,
    age: i,
  }))

  it("paginates rows and navigates pages", async () => {
    const user = userEvent.setup()
    render(
      <DataTable<Row> data={manyRows} columns={columns} getRowId={(row) => row.id} pageSize={10} />,
    )

    expect(screen.getByText("Showing 1–10 of 25")).toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(11) // header + 10 rows

    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByText("Showing 11–20 of 25")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Last page" }))
    expect(screen.getByText("Showing 21–25 of 25")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Previous page" }))
    expect(screen.getByText("Showing 11–20 of 25")).toBeInTheDocument()
  })

  it("changes page size", async () => {
    const user = userEvent.setup()
    render(
      <DataTable<Row> data={manyRows} columns={columns} getRowId={(row) => row.id} pageSize={10} />,
    )

    await user.selectOptions(screen.getByLabelText("Rows per page"), "25")
    expect(screen.getByText("Showing 1–25 of 25")).toBeInTheDocument()
  })
})

describe("DataTable selection", () => {
  it("selects individual rows and select-all with indeterminate state", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    setup({ selectable: true, onSelectionChange })

    const rowCheckboxes = screen.getAllByRole("checkbox", {
      name: /select row/i,
    })
    expect(rowCheckboxes).toHaveLength(3)

    await user.click(rowCheckboxes[0])
    expect(onSelectionChange).toHaveBeenLastCalledWith(["1"])

    const selectAll = screen.getByRole("checkbox", {
      name: /select all rows/i,
    })
    expect(selectAll).toHaveAttribute("aria-checked", "mixed")

    await user.click(selectAll)
    expect(onSelectionChange).toHaveBeenLastCalledWith(["1", "2", "3"])
    expect(selectAll).toHaveAttribute("aria-checked", "true")

    await user.click(selectAll)
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
    expect(selectAll).toHaveAttribute("aria-checked", "false")
  })

  it("select-all on a later page uses global row indexes without getRowId", async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    const manyRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
      id: `row-${i}`,
      name: `Person ${i}`,
      age: i,
    }))
    render(
      <DataTable<Row>
        data={manyRows}
        columns={columns}
        selectable
        onSelectionChange={onSelectionChange}
        pageSize={10}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Next page" }))
    await user.click(screen.getByRole("checkbox", { name: /select all rows/i }))

    // Default row ids are global indexes within `sorted`, so page 2 yields "10"–"19".
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
    ])
    for (const checkbox of screen.getAllByRole("checkbox", { name: /select row/i })) {
      expect(checkbox).toBeChecked()
    }
  })
})

describe("DataTable virtualization", () => {
  const manyRows: Row[] = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    name: `Person ${i}`,
    age: i,
  }))

  function renderVirtual() {
    return render(
      <DataTable<Row>
        data={manyRows}
        columns={columns}
        getRowId={(row) => row.id}
        pagination={false}
        virtualize
        rowHeight={40}
        virtualHeight={200}
        overscan={2}
      />,
    )
  }

  it("renders only a window of rows with spacer rows", () => {
    const { container } = renderVirtual()
    const bodyRows = container.querySelectorAll("tbody tr[data-slot='table-row']")
    expect(bodyRows.length).toBeLessThan(manyRows.length)
    // Spacer rows keep the scrollbar height stable.
    const spacers = container.querySelectorAll("tbody tr[aria-hidden='true']")
    expect(spacers.length).toBeGreaterThan(0)
    expect(screen.queryByText("Person 99")).not.toBeInTheDocument()
  })

  it("renders new rows when the viewport scrolls", async () => {
    const { container } = renderVirtual()
    const viewport = container.querySelector<HTMLElement>("[data-slot='data-table-viewport']")!
    expect(viewport).toBeTruthy()

    fireEvent.scroll(viewport, { target: { scrollTop: 2000 } })

    await waitFor(() => {
      expect(screen.getByText("Person 50")).toBeInTheDocument()
    })
    expect(screen.queryByText("Person 0")).not.toBeInTheDocument()
  })
})

describe("DataTable empty state and search", () => {
  it("renders the empty state when there is no data", () => {
    render(<DataTable<Row> data={[]} columns={columns} emptyState={<span>Nothing here</span>} />)
    expect(screen.getByText("Nothing here")).toBeInTheDocument()
  })

  it("renders a default empty message", () => {
    render(<DataTable<Row> data={[]} columns={columns} />)
    expect(screen.getByText("No results.")).toBeInTheDocument()
  })

  it("filters rows via the global search input", async () => {
    const user = userEvent.setup()
    setup({ searchable: true })

    await user.type(screen.getByRole("searchbox"), "bob")
    const cells = screen.getAllByRole("cell").map((c) => c.textContent)
    expect(cells).toEqual(["Bob", "25"])

    const searchbox = screen.getByRole("searchbox")
    await user.clear(searchbox)
    await user.type(searchbox, "zzz")
    expect(screen.getByText("No results.")).toBeInTheDocument()
  })

  it("renders skeleton rows while loading", () => {
    const { container } = setup({ loading: true, loadingRows: 3 })
    expect(container.querySelectorAll("tbody [data-slot='table-row']")).toHaveLength(3)
    expect(screen.queryByText("Alice")).not.toBeInTheDocument()
  })
})

describe("DataTable stickyFirstColumn", () => {
  it("pins the first column and leaves the rest scrollable", () => {
    const { container } = setup({ stickyFirstColumn: true })

    const headCells = container.querySelectorAll("thead [data-slot='table-head']")
    expect(headCells[0].className).toContain("sticky")
    expect(headCells[0].className).toContain("left-0")
    expect(headCells[1].className).not.toContain("sticky")

    const bodyCells = container.querySelectorAll("tbody [data-slot='table-cell']")
    expect(bodyCells[0].className).toContain("sticky")
    expect(bodyCells[1].className).not.toContain("sticky")
  })

  it("offsets the first data column past the pinned selection column", () => {
    const { container } = setup({ stickyFirstColumn: true, selectable: true })

    const headCells = container.querySelectorAll("thead [data-slot='table-head']")
    // Checkbox column pins at the scroll edge…
    expect(headCells[0].className).toContain("left-0")
    // …and the first data column pins just past its fixed w-10 width.
    expect(headCells[1].className).toContain("left-10")
  })

  it("does not pin columns by default", () => {
    const { container } = setup()
    const headCells = container.querySelectorAll("thead [data-slot='table-head']")
    expect(headCells[0].className).not.toContain("sticky")
  })
})
