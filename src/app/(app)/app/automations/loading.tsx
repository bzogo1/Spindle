import { LoadingPanel } from "@/components/app/states/loading-panel"
import { SkeletonPage } from "@/components/app/states/skeleton"

export default function AutomationsLoading() {
  return (
    <LoadingPanel label="Loading automations" className="min-h-48">
      <SkeletonPage />
    </LoadingPanel>
  )
}
