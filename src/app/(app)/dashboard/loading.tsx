import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function DashboardLoading() {
  return (
    <LoadingPanel label="Loading dashboard" className="min-h-48">
      <ScreenSkeleton variant="dashboard" />
    </LoadingPanel>
  )
}
