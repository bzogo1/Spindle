import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"

export default function AdminUsersLoading() {
  return (
    <LoadingPanel label="Loading users" className="min-h-48">
      <ScreenSkeleton variant="settings" />
    </LoadingPanel>
  )
}
