import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Skeleton } from "@/components/app/states/skeleton"

/** Placeholder mirroring `.app-notification-item`: icon, title, body, time. */
function NotificationRowSkeleton() {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <Skeleton className="size-8 shrink-0 rounded-[9px]" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-16" />
      </div>
    </div>
  )
}

export default function NotificationsLoading() {
  return (
    <div className="app-page app-notifications-page">
      <LoadingPanel label="Loading notifications" className="min-h-48">
        <header className="app-page-head">
          <div className="grid gap-3">
            <Skeleton className="h-7 w-48 max-w-full" />
            <Skeleton className="h-3.5 w-32 max-w-full" />
          </div>
          <div className="app-page-actions">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-48" />
          </div>
        </header>
        <section className="app-panel app-notifications-panel" aria-label="Notification list">
          <ul className="app-notifications-list app-notifications-list--page">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index}>
                <NotificationRowSkeleton />
              </li>
            ))}
          </ul>
        </section>
      </LoadingPanel>
    </div>
  )
}
