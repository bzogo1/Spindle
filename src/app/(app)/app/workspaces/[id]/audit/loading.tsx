import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function WorkspaceAuditLoading() {
  return (
    <LoadingPanel label="Loading audit log" className="min-h-48">
      <ScreenSkeleton variant="settings" />
    </LoadingPanel>
  )
}
