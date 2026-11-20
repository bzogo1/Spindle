import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"

const paginationVariants = cva("mx-auto flex w-full justify-center", {
  variants: {
    align: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
    },
  },
  defaultVariants: {
    align: "center",
  },
})

function Pagination({
  className,
  align,
  ...props
}: React.ComponentProps<"nav"> & VariantProps<typeof paginationVariants>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      data-align={align}
      className={cn(paginationVariants({ align }), className)}
      {...props}
    />
  )
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" className={cn("", className)} {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
  size?: "default" | "sm" | "lg" | "icon"
  /** Disabled links stay focusable-inert: no navigation, dimmed styling. */
  disabled?: boolean
} & React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  disabled,
  onClick,
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      aria-disabled={disabled || undefined}
      data-slot="pagination-link"
      data-active={isActive || undefined}
      data-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      className={cn(
        "focus-visible:border-ring focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        disabled && "pointer-events-none opacity-50",
        size === "icon" && "size-9",
        size === "sm" && "h-8 gap-1.5 px-3",
        size === "lg" && "h-10 px-6",
        size === "default" && "h-9 px-4",
        className,
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      aria-label="Go to previous page"
      data-slot="pagination-previous"
      variant="ghost"
      size="default"
      disabled={disabled}
      className={cn("gap-1 px-2.5 sm:pl-2.5", className)}
      {...props}
    >
      <ChevronLeftIcon className="rtl:-scale-x-100" aria-hidden="true" />
      <span className="hidden sm:block">{children ?? "Previous"}</span>
    </Button>
  )
}

function PaginationNext({
  className,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      aria-label="Go to next page"
      data-slot="pagination-next"
      variant="ghost"
      size="default"
      disabled={disabled}
      className={cn("gap-1 px-2.5 sm:pr-2.5", className)}
      {...props}
    >
      <span className="hidden sm:block">{children ?? "Next"}</span>
      <ChevronRightIcon className="rtl:-scale-x-100" aria-hidden="true" />
    </Button>
  )
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("text-muted-foreground flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

/**
 * Optional page-size selector. Renders a native <select> so it stays
 * keyboard accessible and works without a popover/select dependency.
 */
function PaginationPageSize({
  className,
  pageSize,
  pageSizeOptions = [10, 20, 50, 100],
  onPageSizeChange,
  ...props
}: Omit<React.ComponentProps<"select">, "onChange" | "value"> & {
  pageSize: number
  pageSizeOptions?: number[]
  onPageSizeChange?: (pageSize: number) => void
}) {
  return (
    <label
      data-slot="pagination-page-size"
      className={cn("text-muted-foreground flex items-center gap-2 text-sm", className)}
    >
      <span>Rows per page</span>
      <select
        value={pageSize}
        onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
        className="bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]"
        {...props}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

export type PaginationItemDescriptor =
  { type: "page"; page: number } | { type: "ellipsis"; key: string }

/**
 * Computes a smart page window: first + last page always shown,
 * `siblingCount` neighbors around the current page, ellipsis elsewhere.
 */
function getPaginationItems(
  pageCount: number,
  currentPage: number,
  siblingCount = 1,
): PaginationItemDescriptor[] {
  const totalPages = Math.max(0, Math.floor(pageCount))
  const current = Math.min(Math.max(1, currentPage), Math.max(1, totalPages))
  if (totalPages <= 0) return []
  // Small counts fit entirely — no ellipsis needed.
  if (totalPages <= siblingCount * 2 + 5) {
    return Array.from({ length: totalPages }, (_, i) => ({
      type: "page" as const,
      page: i + 1,
    }))
  }

  // Always show first, last, current ± siblings. Window collapses when
  // the ranges touch; ellipsis fill the gaps.
  const left = Math.max(2, current - siblingCount)
  const right = Math.min(totalPages - 1, current + siblingCount)

  const pages = new Set<number>([1, totalPages])
  for (let page = left; page <= right; page++) pages.add(page)

  const items: PaginationItemDescriptor[] = []
  let prev = 0
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (prev > 0 && page - prev > 1) {
      items.push({ type: "ellipsis", key: `ellipsis-${prev}-${page}` })
    }
    items.push({ type: "page", page })
    prev = page
  }
  return items
}

/**
 * Convenience component that renders the full page-number window with
 * ellipsis for large page counts.
 */
function PaginationPages({
  pageCount,
  currentPage,
  onPageChange,
  siblingCount = 1,
  renderLink,
}: {
  pageCount: number
  currentPage: number
  onPageChange?: (page: number) => void
  siblingCount?: number
  renderLink?: (page: number, isActive: boolean) => React.ReactNode
}) {
  const items = getPaginationItems(pageCount, currentPage, siblingCount)
  return (
    <>
      {items.map((item) =>
        item.type === "ellipsis" ? (
          <PaginationEllipsis key={item.key} />
        ) : renderLink ? (
          <PaginationItem key={item.page}>
            {renderLink(item.page, item.page === currentPage)}
          </PaginationItem>
        ) : (
          <PaginationItem key={item.page}>
            <PaginationLink
              href={`?page=${item.page}`}
              isActive={item.page === currentPage}
              onClick={(event) => {
                if (!onPageChange) return
                event.preventDefault()
                onPageChange(item.page)
              }}
            >
              {item.page}
            </PaginationLink>
          </PaginationItem>
        ),
      )}
    </>
  )
}

export {
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
}
