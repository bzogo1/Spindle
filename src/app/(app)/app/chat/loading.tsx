import { LoadingPanel } from "@/components/app/states/loading-panel"
import { SkeletonPage } from "@/components/app/states/skeleton"

export default function AppChatLoading() {
  return (
    <LoadingPanel label="Loading chat" className="min-h-48">
      <SkeletonPage />
    </LoadingPanel>
  )
}
