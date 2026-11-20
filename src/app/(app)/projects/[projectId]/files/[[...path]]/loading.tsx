import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function ProjectFilesLoading() {
  return (
    <LoadingPanel label="Loading files" className="min-h-48">
      <ScreenSkeleton variant="filesTree" />
    </LoadingPanel>
  )
}
