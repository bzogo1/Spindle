import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function ProjectsLoading() {
  return (
    <LoadingPanel label="Loading projects" className="min-h-48">
      <ScreenSkeleton variant="projects" />
    </LoadingPanel>
  )
}
