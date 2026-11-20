import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Skeleton, SkeletonCard, SkeletonText } from "@/components/app/states/skeleton"

export default function FeedbackLoading() {
  return (
    <div className="app-page">
      <LoadingPanel label="Loading feedback" className="min-h-48">
        <SkeletonCard>
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={4} />
        </SkeletonCard>
      </LoadingPanel>
    </div>
  )
}
