import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function ProjectLabLoading() {
  return (
    <LoadingPanel label="Loading lab" className="min-h-48">
      <ScreenSkeleton variant="lab" />
    </LoadingPanel>
  )
}
