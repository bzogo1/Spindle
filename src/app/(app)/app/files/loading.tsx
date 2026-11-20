import { LoadingPanel } from "@/components/app/states/loading-panel"
import { SkeletonPage } from "@/components/app/states/skeleton"

export default function AppFilesLoading() {
  return (
    <LoadingPanel label="Loading files" className="min-h-48">
      <SkeletonPage />
    </LoadingPanel>
  )
}
