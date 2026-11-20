import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPageSize,
  PaginationPages,
  PaginationPrevious,
  getPaginationItems,
} from "@/components/ui/pagination"

function BasicPagination({ currentPage = 1 }: { currentPage?: number }) {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious disabled={currentPage <= 1} />
        </PaginationItem>
        {[1, 2, 3].map((page) => (
          <PaginationItem key={page}>
            <PaginationLink href={`?page=${page}`} isActive={page === currentPage}>
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext disabled={currentPage >= 3} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

describe("Pagination", () => {
  it("renders navigation landmark and page links", () => {
    render(<BasicPagination />)

    expect(screen.getByRole("navigation", { name: "pagination" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /previous/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument()
  })

  it('marks the active page with aria-current="page"', () => {
    render(<BasicPagination currentPage={2} />)

    const active = screen.getByRole("link", { name: "2" })
    expect(active).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "1" })).not.toHaveAttribute("aria-current")
  })

  it("disables previous at the first page and next at the last", () => {
    const { rerender } = render(<BasicPagination currentPage={1} />)

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled()

    rerender(<BasicPagination currentPage={3} />)
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled()
  })

  it("renders ellipsis as decorative content", () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )

    expect(screen.getByText("More pages")).toHaveClass("sr-only")
  })

  it("supports a page-size selector", async () => {
    const user = userEvent.setup()
    const onPageSizeChange = vi.fn()
    render(<PaginationPageSize pageSize={10} onPageSizeChange={onPageSizeChange} />)

    const select = screen.getByRole("combobox")
    await user.selectOptions(select, "50")
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it("accepts custom page-size options", () => {
    render(<PaginationPageSize pageSize={10} pageSizeOptions={[5, 10]} />)

    const select = screen.getByRole("combobox")
    expect(select.querySelectorAll("option")).toHaveLength(2)
    expect(select.querySelector('option[value="5"]')).toBeInTheDocument()
  })

  it("flips previous/next chevrons in RTL", () => {
    const { container } = render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )

    const svgs = container.querySelectorAll(
      '[data-slot="pagination-previous"] svg, [data-slot="pagination-next"] svg',
    )
    expect(svgs.length).toBeGreaterThan(0)
    svgs.forEach((svg) => expect(svg).toHaveClass("rtl:-scale-x-100"))
  })
})

describe("PaginationLink disabled", () => {
  it("is inert: no aria-current, blocks click, and stays focusable-inert", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <PaginationLink href="?page=2" disabled onClick={onClick}>
        2
      </PaginationLink>,
    )

    const link = screen.getByRole("link", { name: "2" })
    expect(link).toHaveAttribute("aria-disabled", "true")
    expect(link).toHaveAttribute("tabindex", "-1")

    await user.click(link)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe("getPaginationItems", () => {
  it("shows all pages for small counts", () => {
    expect(getPaginationItems(5, 1)).toEqual([
      { type: "page", page: 1 },
      { type: "page", page: 2 },
      { type: "page", page: 3 },
      { type: "page", page: 4 },
      { type: "page", page: 5 },
    ])
  })

  it("windows around the current page with first/last pinned", () => {
    const items = getPaginationItems(20, 10, 1)

    expect(items[0]).toEqual({ type: "page", page: 1 })
    expect(items.at(-1)).toEqual({ type: "page", page: 20 })
    const pages = items.filter((i) => i.type === "page").map((i) => i.page)
    expect(pages).toEqual([1, 9, 10, 11, 20])
    expect(items.filter((i) => i.type === "ellipsis")).toHaveLength(2)
  })

  it("avoids ellipsis near the boundaries", () => {
    expect(getPaginationItems(8, 2, 1)).toEqual([
      { type: "page", page: 1 },
      { type: "page", page: 2 },
      { type: "page", page: 3 },
      { type: "ellipsis", key: "ellipsis-3-8" },
      { type: "page", page: 8 },
    ])
  })

  it("clamps out-of-range current pages", () => {
    const items = getPaginationItems(10, 99, 1)
    expect(items.at(-1)).toEqual({ type: "page", page: 10 })
  })
})

describe("PaginationPages", () => {
  it("renders windowed pages and calls onPageChange", async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(
      <Pagination>
        <PaginationContent>
          <PaginationPages pageCount={15} currentPage={1} onPageChange={onPageChange} />
        </PaginationContent>
      </Pagination>,
    )

    // current=1, sibling=1 → pages 1..2, ellipsis, 15
    expect(screen.getByRole("link", { name: "15" })).toBeInTheDocument()
    const page5 = screen.queryByRole("link", { name: "5" })
    expect(page5).not.toBeInTheDocument()

    await user.click(screen.getByRole("link", { name: "2" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})
