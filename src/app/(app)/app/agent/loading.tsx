import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function AgentLoading() {
  return (
    <LoadingPanel label="Loading agent runs" className="min-h-48">
      <ScreenSkeleton variant="agent" />
    </LoadingPanel>
  )
}
