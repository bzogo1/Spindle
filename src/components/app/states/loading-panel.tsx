import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import { appStateCopy } from "./copy"
import { Skeleton, SkeletonCard, SkeletonTable, SkeletonText } from "./skeleton"

type LoadingPanelVariant = "lines" | "cards" | "table" | "panel"

function PanelSkeleton({ variant, lines }: { variant: LoadingPanelVariant; lines: number }) {
  if (variant === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    )
  }

  if (variant === "table") {
    return <SkeletonTable rows={5} columns={4} />
  }

  if (variant === "panel") {
    return (
      <div className="bg-card grid gap-4 rounded-xl border p-5">
        <Skeleton className="h-4 w-36" />
        <SkeletonText lines={lines} />
      </div>
    )
  }

  return <SkeletonText lines={lines} />
}

export interface LoadingPanelProps {
  label?: string
  variant?: LoadingPanelVariant
  lines?: number
  className?: string
  children?: ReactNode
}

/** Accessible loading presentation for a pane or section. */
export function LoadingPanel({
  label = appStateCopy.loading.panel,
  variant = "lines",
  lines = 3,
  className,
  children,
}: LoadingPanelProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-slot="loading-panel"
      data-variant={variant}
      className={cn("grid gap-4", className)}
    >
      <span className="sr-only">{label}</span>
      {children ?? <PanelSkeleton variant={variant} lines={lines} />}
    </div>
  )
}
