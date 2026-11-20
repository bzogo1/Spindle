import { LoadingPanel } from "@/components/app/states/loading-panel"
import { SkeletonPage } from "@/components/app/states/skeleton"

export default function AppLabLoading() {
  return (
    <LoadingPanel label="Loading lab" className="min-h-48">
      <SkeletonPage />
    </LoadingPanel>
  )
}
