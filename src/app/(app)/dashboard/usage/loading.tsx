import type { ReactNode } from "react"

import { LoadingPanel } from "@/components/app/states/loading-panel"
import {
  Skeleton,
  SkeletonTable,
  SkeletonText,
} from "@/components/app/states/skeleton"

/** `.app-panel` shell with a title/description head and skeleton body. */
function PanelSkeleton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="app-panel" aria-label={label}>
      <div className="app-panel-head">
        <div className="grid gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
      </div>
      {children}
    </section>
  )
}

/** Usage meter row: label + status, values, progress bar, detail line. */
function UsageMeterSkeleton() {
  return (
    <div className="app-usage-meter">
      <div className="app-usage-meter-head">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="app-usage-meter-values">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3.5 w-10" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  )
}

export default function UsageLoading() {
  return (
    <div className="app-page">
      <LoadingPanel label="Loading usage and plan" className="min-h-48">
        <div className="app-page-head">
          <div className="grid gap-3">
            <Skeleton className="h-8 w-48 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="app-page-actions">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-36" />
          </div>
        </div>

        <div className="app-usage-grid">
          <PanelSkeleton label="Current plan">
            <div className="app-plan-summary">
              <div className="app-plan-name-row">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-8 w-28" />
              <div className="grid w-full gap-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="flex items-center justify-between gap-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                ))}
              </div>
              <SkeletonText lines={2} lineClassName="w-full" />
              <Skeleton className="h-10 w-32" />
            </div>
          </PanelSkeleton>

          <PanelSkeleton label="Usage this period">
            <div className="app-usage-meters">
              {Array.from({ length: 5 }, (_, index) => (
                <UsageMeterSkeleton key={index} />
              ))}
            </div>
          </PanelSkeleton>

          <PanelSkeleton label="Usage alerts">
            <SkeletonText lines={3} lineClassName="w-full" />
          </PanelSkeleton>
        </div>

        <div className="app-usage-grid">
          <PanelSkeleton label="Requests per day">
            <Skeleton className="h-64 w-full rounded-lg" />
          </PanelSkeleton>
          <PanelSkeleton label="Tokens per day">
            <Skeleton className="h-64 w-full rounded-lg" />
          </PanelSkeleton>
        </div>

        <PanelSkeleton label="Usage forecast">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="grid gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-48 w-full rounded-lg" />
        </PanelSkeleton>

        <PanelSkeleton label="Month over month">
          <SkeletonTable rows={4} columns={4} />
        </PanelSkeleton>

        <PanelSkeleton label="Usage by project">
          <SkeletonTable rows={4} columns={4} />
        </PanelSkeleton>

        <div className="app-dashboard-columns">
          <PanelSkeleton label="What's included">
            <SkeletonTable rows={5} columns={4} />
          </PanelSkeleton>
          <PanelSkeleton label="Billing history">
            <SkeletonTable rows={4} columns={5} />
          </PanelSkeleton>
        </div>
      </LoadingPanel>
    </div>
  )
}
