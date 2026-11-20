import { LoadingPanel } from "@/components/app/states/loading-panel"
import {
  Skeleton,
  SkeletonListItem,
  SkeletonTable,
  SkeletonText,
} from "@/components/app/states/skeleton"

/** Panel head placeholder mirroring `.app-panel-head` (title + description). */
function PanelHeadSkeleton() {
  return (
    <div className="app-panel-head">
      <div className="grid gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3.5 w-56 max-w-full" />
      </div>
    </div>
  )
}

/** Toolbar placeholder mirroring the DataTable search + filter + export row. */
function MembersToolbarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9 w-28" />
      <Skeleton className="h-9 w-28" />
    </div>
  )
}

export default function TeamMembersLoading() {
  return (
    <div className="app-page app-team-members">
      <LoadingPanel label="Loading team members" className="min-h-48">
        <header className="app-dashboard-header">
          <div className="app-dashboard-heading">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-48 max-w-full" />
            <SkeletonText lines={2} lineClassName="w-full max-w-xl" />
          </div>
          <Skeleton className="h-10 w-32" />
        </header>

        <section className="app-panel" aria-label="Members">
          <PanelHeadSkeleton />
          <div className="grid gap-4">
            <MembersToolbarSkeleton />
            <SkeletonTable rows={4} columns={6} />
          </div>
        </section>

        <section className="app-panel" aria-label="Pending invites">
          <PanelHeadSkeleton />
          <div className="grid gap-4">
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        </section>
      </LoadingPanel>
    </div>
  )
}
