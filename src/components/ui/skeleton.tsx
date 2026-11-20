import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/**
 * Base shimmer block. Size and shape are entirely driven by `className`
 * (e.g. `h-4 w-1/2`, `size-10 rounded-full`). The global
 * `prefers-reduced-motion` guard in ui.css/styles.css neuters
 * `animate-pulse`, so no extra reduced-motion handling is needed here.
 */
function Skeleton({
  className,
  animated = true,
  ...props
}: ComponentProps<"div"> & { animated?: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("bg-muted rounded-md", animated && "animate-pulse", className)}
      {...props}
    />
  )
}

/** Announces itself as a loading region; the visible blocks stay aria-hidden. */
function SkeletonStatus({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div role="status" className={className} {...props}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  )
}

/** Multi-line text placeholder; the last line is shortened like real copy. */
function SkeletonText({
  lines = 3,
  className,
  lineClassName,
  ...props
}: ComponentProps<"div"> & { lines?: number; lineClassName?: string }) {
  return (
    <SkeletonStatus className={cn("grid gap-2", className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 && "w-2/3", lineClassName)}
        />
      ))}
    </SkeletonStatus>
  )
}

/** Card-shaped placeholder: bordered surface with a title and body lines. */
function SkeletonCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton-card"
      className={cn("bg-card grid gap-4 rounded-xl border p-5", className)}
      {...props}
    >
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  )
}

/** Table-shaped placeholder with a header row and `rows` body rows of `columns` cells. */
function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
  ...props
}: ComponentProps<"div"> & { rows?: number; columns?: number }) {
  return (
    <div
      data-slot="skeleton-table"
      role="status"
      className={cn("grid gap-3", className)}
      {...props}
    >
      <span className="sr-only">Loading…</span>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={`head-${index}`} className="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={`row-${row}`}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={`cell-${row}-${column}`}
              className={cn("h-4", column === 0 && "w-3/4")}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Single list row: round avatar placeholder plus two text lines. */
function SkeletonListItem({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex items-start gap-3", className)} {...props}>
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="grid min-w-0 flex-1 gap-2">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}

/** Stacked list placeholder with `items` rows. */
function SkeletonList({
  items = 4,
  className,
  ...props
}: ComponentProps<"div"> & { items?: number }) {
  return (
    <div data-slot="skeleton-list" role="status" className={cn("grid gap-4", className)} {...props}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: items }, (_, index) => (
        <SkeletonListItem key={index} />
      ))}
    </div>
  )
}

/** Circular avatar placeholder; size via className (default 2.5rem). */
function SkeletonAvatar({ className, ...props }: ComponentProps<"div">) {
  return (
    <Skeleton
      data-slot="skeleton-avatar"
      role="status"
      aria-label="Loading"
      // Skeleton defaults to aria-hidden; the status role needs AT exposure.
      aria-hidden={false}
      className={cn("size-10 rounded-full", className)}
      {...props}
    />
  )
}

const chartBarHeights = [45, 70, 55, 85, 60, 95, 75, 50]

/** Chart placeholder: title bar plus a card with baseline-aligned bars. */
function SkeletonChart({
  className,
  bars = chartBarHeights.length,
  ...props
}: ComponentProps<"div"> & { bars?: number }) {
  return (
    <div
      data-slot="skeleton-chart"
      role="status"
      className={cn("grid gap-3", className)}
      {...props}
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-40" />
      <div className="bg-card flex h-48 items-end gap-2 rounded-xl border p-4">
        {Array.from({ length: bars }, (_, index) => (
          <Skeleton
            key={index}
            className="flex-1"
            style={{ height: `${chartBarHeights[index % chartBarHeights.length]}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export {
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonChart,
  SkeletonList,
  SkeletonListItem,
  SkeletonTable,
  SkeletonText,
}
