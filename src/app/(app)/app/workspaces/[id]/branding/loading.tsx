import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function WorkspaceBrandingLoading() {
  return (
    <LoadingPanel label="Loading workspace branding" className="min-h-48">
      <ScreenSkeleton variant="settings" />
    </LoadingPanel>
  )
}
