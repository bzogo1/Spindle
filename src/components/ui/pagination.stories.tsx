import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPageSize,
  PaginationPages,
  PaginationPrevious,
} from "./pagination"

const meta = {
  title: "UI/Pagination",
  tags: ["autodocs"],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const PageWindow: Story = {
  render: function PageWindowStory() {
    const [page, setPage] = useState(8)
    return (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
          </PaginationItem>
          <PaginationPages
            pageCount={42}
            currentPage={page}
            onPageChange={setPage}
            siblingCount={1}
          />
          <PaginationItem>
            <PaginationNext disabled={page >= 42} onClick={() => setPage((p) => p + 1)} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )
  },
}

export const PageSize: Story = {
  render: function PageSizeStory() {
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    return (
      <div className="flex flex-col items-center gap-3">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
            </PaginationItem>
            <PaginationPages
              pageCount={Math.ceil(240 / pageSize)}
              currentPage={page}
              onPageChange={setPage}
            />
            <PaginationItem>
              <PaginationNext
                disabled={page >= Math.ceil(240 / pageSize)}
                onClick={() => setPage((p) => p + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <PaginationPageSize
          pageSize={pageSize}
          pageSizeOptions={[10, 20, 50, 100]}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          aria-label="Rows per page"
        />
      </div>
    )
  },
}
