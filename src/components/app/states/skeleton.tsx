import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/utils"

import type { AppScreenKey } from "./copy"

type SkeletonProps = ComponentProps<"div"> & {
  animated?: boolean
}

/** Base shimmer block. Compose the layout-shaped variants below for real pages. */
export function Skeleton({ className, animated = true, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", animated && "animate-pulse", className)}
      {...props}
    />
  )
}

export function SkeletonText({
  lines = 3,
  className,
  lineClassName,
  ...props
}: ComponentProps<"div"> & { lines?: number; lineClassName?: string }) {
  return (
    <div className={cn("grid gap-2", className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index === lines - 1 && "w-2/3", lineClassName)}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children?: ReactNode }) {
  return (
    <div className={cn("grid gap-4 rounded-xl border bg-card p-5", className)} {...props}>
      {children ?? (
        <>
          <Skeleton className="h-4 w-1/3" />
          <SkeletonText lines={3} />
        </>
      )}
    </div>
  )
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
  ...props
}: ComponentProps<"div"> & { rows?: number; columns?: number }) {
  return (
    <div className={cn("grid gap-3", className)} {...props}>
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

function PageHeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid gap-3">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {actions ? <Skeleton className="h-9 w-32" /> : null}
    </div>
  )
}

function CardGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonCard key={index} className="gap-3 py-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-32" />
          </SkeletonCard>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SkeletonCard>
          <Skeleton className="h-4 w-40" />
          <SkeletonText lines={6} />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={5} />
        </SkeletonCard>
      </div>
    </div>
  )
}

function ProjectSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-24 shrink-0" />
        ))}
      </div>
      <CardGridSkeleton count={3} />
      <SkeletonCard>
        <Skeleton className="h-4 w-44" />
        <SkeletonText lines={5} />
      </SkeletonCard>
    </div>
  )
}

function FilesSkeleton({ tree = false }: { tree?: boolean }) {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className={cn("grid gap-6", tree && "lg:grid-cols-[220px_minmax(0,1fr)]")}>
        {tree ? (
          <SkeletonCard className="gap-3">
            <Skeleton className="h-4 w-28" />
            <SkeletonText lines={7} lineClassName="w-full" />
          </SkeletonCard>
        ) : null}
        <SkeletonCard className="gap-4">
          <SkeletonTable rows={6} columns={5} />
        </SkeletonCard>
      </div>
    </div>
  )
}

function LabSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-32 shrink-0" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SkeletonCard className="min-h-80 gap-4">
          <Skeleton className="h-4 w-36" />
          <SkeletonText lines={8} />
        </SkeletonCard>
        <SkeletonCard className="gap-3">
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={6} />
        </SkeletonCard>
      </div>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <SkeletonCard className="gap-3">
        <Skeleton className="h-4 w-28" />
        <SkeletonText lines={7} lineClassName="w-full" />
      </SkeletonCard>
      <div className="grid gap-4">
        <SkeletonCard className="min-h-96 gap-5">
          <Skeleton className="h-4 w-40" />
          <SkeletonText lines={9} />
        </SkeletonCard>
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  )
}

function AgentSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <SkeletonCard className="gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </SkeletonCard>
      <div className="grid gap-6 xl:grid-cols-2">
        <SkeletonCard className="min-h-72 gap-4">
          <Skeleton className="h-4 w-36" />
          <SkeletonText lines={7} />
        </SkeletonCard>
        <SkeletonCard className="min-h-72 gap-4">
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={7} />
        </SkeletonCard>
      </div>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeaderSkeleton actions={false} />
      <SkeletonCard className="gap-5">
        <Skeleton className="h-5 w-40" />
        <SkeletonText lines={2} />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-32" />
      </SkeletonCard>
      <SkeletonCard className="gap-5">
        <Skeleton className="h-5 w-44" />
        <SkeletonText lines={2} />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-9 w-32" />
      </SkeletonCard>
    </div>
  )
}

const screenSkeletons: Record<AppScreenKey, () => ReactNode> = {
  dashboard: DashboardSkeleton,
  project: ProjectSkeleton,
  files: () => <FilesSkeleton />,
  filesTree: () => <FilesSkeleton tree />,
  lab: LabSkeleton,
  chat: ChatSkeleton,
  agent: AgentSkeleton,
  settings: SettingsSkeleton,
}

/** Layout-shaped loading placeholder for each authenticated screen. */
export function ScreenSkeleton({
  variant,
  className,
}: {
  variant: AppScreenKey
  className?: string
}) {
  const Content = screenSkeletons[variant]
  return (
    <div
      aria-hidden="true"
      data-slot="screen-skeleton"
      data-variant={variant}
      className={className}
    >
      {Content()}
    </div>
  )
}
