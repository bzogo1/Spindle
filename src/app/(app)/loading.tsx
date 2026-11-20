import { appStateCopy } from "@/components/app/states/copy"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Skeleton, SkeletonCard, SkeletonText } from "@/components/app/states/skeleton"

/**
 * Root loading boundary for the authenticated group. It renders inside the app
 * shell, so navigation between screens keeps the sidebar and top bar while the
 * next pane streams in.
 */
export default function AppLoading() {
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
            <SkeletonText lines={5} />
          </SkeletonCard>
        </div>
      </LoadingPanel>
    </div>
  )
}
