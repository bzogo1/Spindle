import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonChart,
  SkeletonList,
  SkeletonStatCard,
  SkeletonTable,
  SkeletonTableRow,
  SkeletonText,
} from "@/components/ui/skeleton"

describe("Skeleton", () => {
  it("renders a muted pulse block with className passthrough", () => {
    const { container } = render(<Skeleton className="h-4 w-24" />)
    const el = container.querySelector('[data-slot="skeleton"]')

    expect(el).toBeInTheDocument()
    expect(el).toHaveClass("bg-muted", "animate-pulse", "h-4", "w-24")
    expect(el).toHaveAttribute("aria-hidden", "true")
  })

  it("omits animate-pulse when animated is false", () => {
    const { container } = render(<Skeleton animated={false} />)

    expect(container.querySelector('[data-slot="skeleton"]')).not.toHaveClass("animate-pulse")
  })
})

describe("SkeletonText", () => {
  it("renders the requested number of lines", () => {
    const { container } = render(<SkeletonText lines={4} />)

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
  })
})

describe("SkeletonCard", () => {
  it("renders a bordered card placeholder and accepts className", () => {
    const { container } = render(<SkeletonCard className="max-w-sm" />)
    const card = container.querySelector('[data-slot="skeleton-card"]')

    expect(card).toBeInTheDocument()
    expect(card).toHaveClass("border", "bg-card", "max-w-sm")
  })
})

describe("SkeletonTable", () => {
  it("renders header plus rows x columns cells", () => {
    const { container } = render(<SkeletonTable rows={3} columns={2} />)

    // 2 header cells + 3 rows x 2 cells
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(8)
    expect(container.querySelector('[data-slot="skeleton-table"]')).toBeInTheDocument()
  })
})

describe("SkeletonTableRow", () => {
  it("renders one cell per column", () => {
    const { container } = render(<SkeletonTableRow columns={3} />)
    const row = container.querySelector('[data-slot="skeleton-table-row"]')

    expect(row).toBeInTheDocument()
    expect(row?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
  })
})

describe("SkeletonStatCard", () => {
  it("renders a stat card placeholder and accepts className", () => {
    const { container } = render(<SkeletonStatCard className="max-w-xs" />)
    const card = container.querySelector('[data-slot="skeleton-stat-card"]')

    expect(card).toBeInTheDocument()
    expect(card).toHaveClass("border", "bg-card", "max-w-xs")
    // label + value + hint
    expect(card?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
  })
})

describe("SkeletonList", () => {
  it("renders the requested number of items", () => {
    const { container } = render(<SkeletonList items={2} />)

    expect(container.querySelectorAll('[data-slot="skeleton-list"] > div')).toHaveLength(2)
  })
})

describe("SkeletonAvatar", () => {
  it("renders a round avatar placeholder with className passthrough", () => {
    const { container } = render(<SkeletonAvatar className="size-16" />)
    const el = container.querySelector('[data-slot="skeleton-avatar"]')

    expect(el).toHaveClass("rounded-full", "size-16")
  })
})

describe("SkeletonChart", () => {
  it("renders a chart placeholder with the requested bar count", () => {
    const { container } = render(<SkeletonChart bars={5} />)
    const chart = container.querySelector('[data-slot="skeleton-chart"]')

    expect(chart).toBeInTheDocument()
    // title bar + 5 bars
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6)
  })
})
