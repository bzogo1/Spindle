import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function ProjectChatLoading() {
  return (
    <LoadingPanel label="Loading chat" className="min-h-48">
      <ScreenSkeleton variant="chat" />
    </LoadingPanel>
  )
}
