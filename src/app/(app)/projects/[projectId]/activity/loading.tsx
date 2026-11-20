import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function ProjectActivityLoading() {
  return (
    <LoadingPanel label="Loading activity" className="min-h-48">
      <ScreenSkeleton variant="project" />
    </LoadingPanel>
  )
}
