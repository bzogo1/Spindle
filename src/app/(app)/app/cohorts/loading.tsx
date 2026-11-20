import { appStateCopy } from "@/components/app/states/copy"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Skeleton, SkeletonCard, SkeletonText } from "@/components/app/states/skeleton"

/** Loading boundary for the cohorts page inside the app shell. */
export default function CohortsLoading() {
  return (
    <div className="app-page">
      <LoadingPanel label={appStateCopy.loading.page} className="min-h-48">
        <div className="grid gap-6">
          <div className="grid gap-3">
            <Skeleton className="h-8 w-56 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <SkeletonCard>
            <Skeleton className="h-4 w-40" />
            <SkeletonText lines={6} />
          </SkeletonCard>
        </div>
      </LoadingPanel>
    </div>
  )
}
