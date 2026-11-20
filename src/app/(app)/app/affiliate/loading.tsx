import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function AffiliateLoading() {
  return (
    <LoadingPanel label="Loading affiliate program" className="min-h-48">
      <ScreenSkeleton variant="settings" />
    </LoadingPanel>
  )
}
