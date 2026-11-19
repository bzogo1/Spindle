import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function ProjectLoading() {
  return (
    <LoadingPanel label="Loading project" className="min-h-48">
      <ScreenSkeleton variant="project" />
    </LoadingPanel>
  )
}
