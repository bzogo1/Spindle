"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Bell, CheckCheck, FolderKanban, LayoutList, MessagesSquare, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPages,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { useProjects } from "@/lib/api"
import { groupNotificationsIntoThreads } from "@/lib/notifications/threads"
import { EmptyState } from "@/components/app/states/empty-state"

import { CATEGORY_COPY } from "./notification-preferences-screen"
import { groupNotificationsByCategory } from "./notification-groups"
import { NotificationItem } from "./notification-item"
import { NotificationPermissionBanner } from "./notification-permission-banner"
import { NotificationThreadView } from "./notification-thread"
import {
  APP_NOTIFICATION_CATEGORIES,
  useAppNotifications,
  type AppNotification,
  type AppNotificationCategory,
} from "./notifications-provider"

/** Client-side page size for the notifications feed (provider caps at 50). */
const NOTIFICATIONS_PAGE_SIZE = 10

/** Sentinel select value for the unfiltered "All projects" view. */
const ALL_PROJECTS = "all"
/** Sentinel select value for the unfiltered "All categories" view. */
const ALL_CATEGORIES = "all"

type NotificationsView = "category" | "threads"

const VIEW_OPTIONS: readonly { value: NotificationsView; label: string }[] = [
  { value: "category", label: "By category" },
  { value: "threads", label: "Threads" },
]

export function NotificationsScreen() {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    toggleRead,
    dismiss,
    snooze,
    performAction,
  } = useAppNotifications()
  const projectsQuery = useProjects()
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS)
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES)
  const [view, setView] = useState<NotificationsView>("category")
  const [page, setPage] = useState(1)

  const projects = projectsQuery.data ?? []
  // Untagged notifications (no `projectId`) only appear under "All projects" —
  // a project filter is an exact match, not a "workspace + project" union.
  const filteredNotifications = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          (projectFilter === ALL_PROJECTS || notification.projectId === projectFilter) &&
          (categoryFilter === ALL_CATEGORIES || notification.category === categoryFilter),
      ),
    [notifications, projectFilter, categoryFilter],
  )

  // Keep the select valid even if the filtered project disappears from the
  // list (deleted/archived project, failed refetch) — show its raw id rather
  // than silently snapping back to "All".
  const projectMissing =
    projectFilter !== ALL_PROJECTS && !projects.some((project) => project.id === projectFilter)

  // Only offer categories that actually appear in the feed, in the canonical
  // category order — an empty select option list would be noise.
  const presentCategories = useMemo(() => {
    const present = new Set(
      notifications
        .map((notification) => notification.category)
        .filter((category): category is AppNotificationCategory => category !== undefined),
    )
    return APP_NOTIFICATION_CATEGORIES.filter((category) => present.has(category))
  }, [notifications])

  function changeProjectFilter(next: string) {
    setProjectFilter(next)
    // A different result set starts at page 1 — clamping alone could leave the
    // user on a now-empty tail page.
    setPage(1)
  }

  function changeCategoryFilter(next: string) {
    setCategoryFilter(next)
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filteredNotifications.length / NOTIFICATIONS_PAGE_SIZE))
  // Clamp instead of resetting: realtime pushes prepend items, which shifts
  // page contents but must not yank the user back to page 1 (or crash when
  // the cap trims the tail and the current page falls out of range).
  const currentPage = Math.min(page, pageCount)

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const pageStart =
    filteredNotifications.length === 0 ? 0 : (currentPage - 1) * NOTIFICATIONS_PAGE_SIZE + 1
  const pageEnd = Math.min(currentPage * NOTIFICATIONS_PAGE_SIZE, filteredNotifications.length)
  const pageItems = filteredNotifications.slice(pageStart - 1, pageEnd)
  // Grouping happens *within* the current page slice (paginate first, then
  // group) so the pager's "Showing X–Y of N" counts and the page-size cap stay
  // exact, and realtime prepends keep flowing through the same clamped-page
  // logic — a live item simply lands in page 1's groups.
  const pageGroups = groupNotificationsByCategory(pageItems)
  const pageThreads = groupNotificationsIntoThreads(pageItems)

  function renderNotificationItem(notification: AppNotification) {
    return (
      <NotificationItem
        key={notification.id}
        notification={notification}
        onRead={markRead}
        onToggleRead={toggleRead}
        onSnooze={snooze}
        onDismiss={dismiss}
        onAction={performAction}
      />
    )
  }

  const showFilters = projects.length > 0 || projectMissing || presentCategories.length > 0

  return (
    <div className="app-page app-notifications-page">
      <header className="app-page-head">
        <div>
          <h1>Notifications</h1>
          <p className="app-page-subtitle">
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </p>
        </div>
        <div className="app-page-actions">
          <Button
            type="button"
            variant="outline"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck aria-hidden="true" />
            Mark all read
          </Button>
          <Button asChild variant="outline">
            <Link href="/app/account/notifications">
              <Settings aria-hidden="true" />
              Notification preferences
            </Link>
          </Button>
        </div>
      </header>

      <NotificationPermissionBanner />

      <section className="app-panel app-notifications-panel" aria-label="Notification list">
        {showFilters ? (
          <div className="app-notifications-filters">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Notification grouping"
              >
                {VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      view === option.value
                        ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-pressed={view === option.value}
                    onClick={() => setView(option.value)}
                  >
                    {option.value === "threads" ? (
                      <MessagesSquare aria-hidden="true" className="mr-1 inline size-3.5" />
                    ) : (
                      <LayoutList aria-hidden="true" className="mr-1 inline size-3.5" />
                    )}
                    {option.label}
                  </button>
                ))}
              </div>
              {presentCategories.length > 1 ? (
                <label className="app-sort-field">
                  <span className="sr-only">Filter by category</span>
                  <select
                    value={categoryFilter}
                    onChange={(event) => changeCategoryFilter(event.target.value)}
                    aria-label="Filter by category"
                  >
                    <option value={ALL_CATEGORIES}>All categories</option>
                    {presentCategories.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_COPY[category].label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {projects.length > 0 || projectMissing ? (
                <label className="app-sort-field">
                  <span className="sr-only">Filter by project</span>
                  <select
                    value={projectFilter}
                    onChange={(event) => changeProjectFilter(event.target.value)}
                    aria-label="Filter by project"
                  >
                    <option value={ALL_PROJECTS}>All projects</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                    {projectMissing ? <option value={projectFilter}>{projectFilter}</option> : null}
                  </select>
                </label>
              ) : null}
            </div>
          </div>
        ) : null}

        {filteredNotifications.length === 0 ? (
          notifications.length === 0 ? (
            <EmptyState
              icon={<Bell aria-hidden="true" />}
              title="You're all caught up"
              body="New workspace, project, lab, and agent updates will show up here."
            />
          ) : projectFilter !== ALL_PROJECTS ? (
            <EmptyState
              icon={<FolderKanban aria-hidden="true" />}
              title="No notifications for this project"
              body="Nothing in the feed is tagged with the selected project yet."
              primaryAction={{
                label: "Show all projects",
                variant: "secondary",
                onClick: () => changeProjectFilter(ALL_PROJECTS),
              }}
            />
          ) : categoryFilter !== ALL_CATEGORIES ? (
            <EmptyState
              icon={<FolderKanban aria-hidden="true" />}
              title="No notifications in this category"
              body="Nothing in the feed matches the selected category."
              primaryAction={{
                label: "Show all categories",
                variant: "secondary",
                onClick: () => changeCategoryFilter(ALL_CATEGORIES),
              }}
            />
          ) : (
            <EmptyState
              icon={<FolderKanban aria-hidden="true" />}
              title="No notifications match the filters"
              body="Nothing in the feed matches the selected filters."
              primaryAction={{
                label: "Clear filters",
                variant: "secondary",
                onClick: () => {
                  changeProjectFilter(ALL_PROJECTS)
                  changeCategoryFilter(ALL_CATEGORIES)
                },
              }}
            />
          )
        ) : view === "threads" ? (
          <ul className="app-notifications-list app-notifications-list--page">
            {pageThreads.map((thread) => {
              // Same subject can own several bursts — latestAt disambiguates.
              const threadKey = `${thread.key}@${thread.latestAt}`
              return thread.items.length === 1 ? (
                <li key={threadKey}>{renderNotificationItem(thread.items[0])}</li>
              ) : (
                <NotificationThreadView
                  key={threadKey}
                  thread={thread}
                  renderItem={renderNotificationItem}
                />
              )
            })}
          </ul>
        ) : (
          <ul className="app-notifications-list app-notifications-list--page">
            {pageGroups.map((group) => (
              <li key={group.key} className="app-notification-category">
                <h2 className="app-notification-category-title">{group.label}</h2>
                <ul className="app-notification-category-list">
                  {group.items.map((notification) => (
                    <li key={notification.id}>{renderNotificationItem(notification)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {filteredNotifications.length > 0 ? (
          <div className="app-notifications-pager">
            <p className="app-notifications-pager-count">
              Showing {pageStart}–{pageEnd} of {filteredNotifications.length}
            </p>
            {pageCount > 1 ? (
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      disabled={currentPage <= 1}
                      onClick={() => setPage(currentPage - 1)}
                    />
                  </PaginationItem>
                  <PaginationPages
                    pageCount={pageCount}
                    currentPage={currentPage}
                    onPageChange={setPage}
                    siblingCount={1}
                  />
                  <PaginationItem>
                    <PaginationNext
                      disabled={currentPage >= pageCount}
                      onClick={() => setPage(currentPage + 1)}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
