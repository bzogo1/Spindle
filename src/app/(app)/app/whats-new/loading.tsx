import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function WhatsNewLoading() {
  return (
    <LoadingPanel label="Loading what's new" className="min-h-48">
      <ScreenSkeleton variant="settings" />
    </LoadingPanel>
  )
}
