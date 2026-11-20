"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  Bot,
  FlaskConical,
  FolderKanban,
  HardDrive,
  MessageSquare,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { ScreenState } from "@/components/app/states/screen-state"
import { ProjectSwitcher } from "@/components/app/project-switcher"
import { EmptyState } from "@/components/dashboard/empty-state"
import { OnboardingResumeBanner } from "@/components/onboarding/onboarding-resume-banner"
import {
  NoProjectsEmptyState,
  SearchNoResultsEmptyState,
} from "@/components/dashboard/empty-states"
import { useWorkspaceDashboard } from "@/lib/api"
import { mergeActivityEvents } from "@/lib/activity/client"
import { useActivityEvents } from "@/lib/activity/use-activity-events"
import type { ProjectSummary, User } from "@/lib/api/types"

import { ActivityFeed } from "./activity-feed"
import { CopyButton } from "./copy-button"
import { dashboardShareHref, parseDashboardShareParams } from "./dashboard-share"
import {
  DASHBOARD_SIDEBAR_WIDGET_IDS,
  DashboardCustomizeDialog,
  useDashboardWidgets,
  type DashboardWidgetId,
} from "./dashboard-widgets"
import { NewProjectDialog } from "./new-project-dialog"
import { formatBytes, formatRelativeTime } from "./format"
import { OPEN_NEW_PROJECT_EVENT, OPEN_NEW_PROJECT_STORAGE_KEY } from "./new-project-events"
import { useDashboardLayout, type DashboardProjectSort } from "./dashboard-layout"

type ProjectSort = DashboardProjectSort

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "created", label: "Recently created" },
  { value: "files", label: "Most files" },
]

function projectTimestamp(project: ProjectSummary) {
  return project.latestActivityAt ?? project.updatedAt
}

function matchesQuery(project: ProjectSummary, query: string) {
  if (!query) return true
  const haystack = [
    project.name,
    project.slug,
    project.description ?? "",
    project.owner.name ?? "",
    project.owner.email,
    project.visibility,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query)
}

function sortProjects(projects: ProjectSummary[], sort: ProjectSort) {
  return [...projects].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name)
    if (sort === "created") return b.createdAt.localeCompare(a.createdAt)
    if (sort === "files") return b.fileCount - a.fileCount || a.name.localeCompare(b.name)
    return projectTimestamp(b).localeCompare(projectTimestamp(a)) || a.name.localeCompare(b.name)
  })
}

function userInitial(user: User) {
  return (user.name?.trim().charAt(0) || user.email.charAt(0)).toUpperCase()
}

function userLabel(user: User) {
  return user.name ?? user.email
}

function MemberStack({ project }: { project: ProjectSummary }) {
  const members = project.members ?? []
  const visible = members.slice(0, 4)
  const extra = Math.max(project.memberCount - visible.length, 0)

  if (visible.length === 0) {
    return <span className="app-member-stack-count">{project.memberCount} members</span>
  }

  return (
    <span className="app-member-stack" aria-label={`${project.memberCount} members`}>
      {visible.map((member) => (
        <span
          key={member.id}
          className="app-avatar app-member-avatar"
          title={userLabel(member)}
          aria-hidden="true"
        >
          {userInitial(member)}
        </span>
      ))}
      {extra > 0 ? <span className="app-member-stack-count">+{extra}</span> : null}
    </span>
  )
}

const PROJECT_CARD_ACTIONS = [
  { label: "Files", href: (id: string) => `/projects/${id}/files` },
  { label: "Lab", href: (id: string) => `/projects/${id}/lab` },
  { label: "Chat", href: (id: string) => `/projects/${id}/chat` },
] as const

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article className="app-project-card">
      <Link href={`/projects/${project.id}`} className="app-project-card-open">
        <div className="app-project-card-head">
          <span className="app-project-card-icon" aria-hidden="true">
            <FolderKanban />
          </span>
          <Badge variant="outline" className="app-project-visibility">
            {project.visibility}
          </Badge>
        </div>
        <h3>{project.name}</h3>
        <p>{project.description ?? "No description yet."}</p>
        <dl className="app-project-card-meta">
          <div>
            <dt>Owner</dt>
            <dd>{project.owner.name ?? project.owner.email}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatRelativeTime(projectTimestamp(project))}</dd>
          </div>
          <div>
            <dt>Files</dt>
            <dd>{project.fileCount}</dd>
          </div>
          <div>
            <dt>Lab</dt>
            <dd>{project.labSessionCount}</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd>{project.agentRunCount}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{formatBytes(project.storageBytes)}</dd>
          </div>
        </dl>
        <div className="app-project-card-members">
          <MemberStack project={project} />
        </div>
      </Link>
      <div className="app-project-card-actions" aria-label={`Quick actions for ${project.name}`}>
        {PROJECT_CARD_ACTIONS.map((action) => (
          <Link key={action.label} href={action.href(project.id)} className="app-card-action">
            {action.label}
          </Link>
        ))}
      </div>
    </article>
  )
}

export function DashboardScreen() {
  const query = useWorkspaceDashboard()
  // Workspace-wide live activity (no project filter) merged into the feed.
  const liveActivity = useActivityEvents()
  const [search, setSearch] = useState("")
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Shareable-link params (`?widgets=`/`?sort=`) override the persisted
  // layout for this view without overwriting it (see `dashboard-share.ts`).
  // Keyed on the serialized query — `useSearchParams()` may hand back a new
  // object each render, and the parsed config feeds hook effect deps.
  const shareQuery = searchParams.toString()
  const shareParams = useMemo(
    () => parseDashboardShareParams(new URLSearchParams(shareQuery)),
    [shareQuery],
  )
  // Sort order persists across reloads and syncs across tabs (localStorage).
  const { sort, setSort } = useDashboardLayout(shareParams.sort)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const widgets = useDashboardWidgets(shareParams.widgets)

  // The command menu's "New project" action reaches this screen either through
  // the window event (already mounted) or the storage flag (navigated here).
  useEffect(() => {
    function openNewProject() {
      try {
        sessionStorage.removeItem(OPEN_NEW_PROJECT_STORAGE_KEY)
      } catch {
        // Storage can be unavailable (private mode).
      }
      setNewProjectOpen(true)
    }
    try {
      if (sessionStorage.getItem(OPEN_NEW_PROJECT_STORAGE_KEY)) openNewProject()
    } catch {
      // Storage can be unavailable (private mode).
    }
    window.addEventListener(OPEN_NEW_PROJECT_EVENT, openNewProject)
    return () => window.removeEventListener(OPEN_NEW_PROJECT_EVENT, openNewProject)
  }, [])

  const filteredProjects = useMemo(() => {
    if (!query.data) return []
    const normalized = search.trim().toLowerCase()
    return sortProjects(
      query.data.projects.filter((project) => matchesQuery(project, normalized)),
      sort,
    )
  }, [query.data, search, sort])

  const storagePercent = query.data
    ? query.data.storage.totalBytes > 0
      ? Math.min(100, (query.data.storage.usedBytes / query.data.storage.totalBytes) * 100)
      : 0
    : 0

  const totals = useMemo(() => {
    const projects = query.data?.projects ?? []
    return {
      labSessions: projects.reduce((total, project) => total + project.labSessionCount, 0),
      agentRuns: projects.reduce((total, project) => total + project.agentRunCount, 0),
      members: projects.reduce((total, project) => total + project.memberCount, 0),
    }
  }, [query.data?.projects])

  return (
    <ScreenState
      screen="dashboard"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(dashboard) => {
        const activity = mergeActivityEvents(dashboard.activity, liveActivity)
        const sidebarWidgetOrder = widgets.config.order.filter(
          (id) =>
            (DASHBOARD_SIDEBAR_WIDGET_IDS as readonly string[]).includes(id) &&
            widgets.isVisible(id),
        )

        function renderSidebarWidget(id: DashboardWidgetId) {
          switch (id) {
            case "activity":
              return (
                <section key={id} className="app-panel" aria-labelledby="activity-heading">
                  <div className="app-panel-head">
                    <div>
                      <h2 id="activity-heading">Recent activity</h2>
                      <p>Latest project, file, lab, chat, and agent events.</p>
                    </div>
                  </div>
                  {activity.length === 0 ? (
                    <EmptyState
                      title="No recent activity"
                      description="Activity will appear here as projects, files, runs, and sessions change."
                      primaryAction={{
                        label: "New project",
                        onClick: () => setNewProjectOpen(true),
                      }}
                    />
                  ) : (
                    <ActivityFeed events={activity} />
                  )}
                </section>
              )
            case "storage":
              return (
                <section key={id} className="app-panel" aria-labelledby="storage-heading">
                  <div className="app-panel-head">
                    <div>
                      <h2 id="storage-heading">Storage</h2>
                      <p>Workspace files and compute checkpoints.</p>
                    </div>
                    <span className="app-panel-head-actions">
                      <Link className="app-panel-link" href="/dashboard/usage">
                        Usage &amp; plan
                      </Link>
                      <HardDrive aria-hidden="true" className="app-panel-icon" />
                    </span>
                  </div>
                  <div className="app-storage">
                    <div className="app-storage-row">
                      <span>Used</span>
                      <strong>{formatBytes(dashboard.storage.usedBytes)}</strong>
                    </div>
                    <Progress value={storagePercent} aria-label="Storage used" />
                    <div className="app-storage-row app-storage-row--muted">
                      <span>{formatBytes(dashboard.storage.availableBytes)} available</span>
                      <span>{storagePercent.toFixed(0)}%</span>
                    </div>
                    <dl className="app-storage-breakdown">
                      <div>
                        <dt>Files</dt>
                        <dd>{formatBytes(dashboard.storage.fileBytes)}</dd>
                      </div>
                      <div>
                        <dt>Compute</dt>
                        <dd>{formatBytes(dashboard.storage.computeBytes)}</dd>
                      </div>
                    </dl>
                  </div>
                </section>
              )
            case "quick-actions":
              return (
                <section key={id} className="app-panel" aria-labelledby="quick-actions-heading">
                  <div className="app-panel-head">
                    <div>
                      <h2 id="quick-actions-heading">Quick actions</h2>
                      <p>Jump straight into a task.</p>
                    </div>
                  </div>
                  <div className="app-quick-actions">
                    <button
                      type="button"
                      className="app-quick-link"
                      onClick={() => setNewProjectOpen(true)}
                    >
                      <Plus aria-hidden="true" />
                      <span>
                        <strong>New project</strong>
                        <small>Create a project workspace</small>
                      </span>
                    </button>
                    <Link href="/app/files" className="app-quick-link">
                      <Upload aria-hidden="true" />
                      <span>
                        <strong>Upload file</strong>
                        <small>Add files to a project</small>
                      </span>
                    </Link>
                    <Link href="/app/lab" className="app-quick-link">
                      <FlaskConical aria-hidden="true" />
                      <span>
                        <strong>Run lab tool</strong>
                        <small>Start a lab session</small>
                      </span>
                    </Link>
                    <Link href="/app/chat" className="app-quick-link">
                      <MessageSquare aria-hidden="true" />
                      <span>
                        <strong>Open chat</strong>
                        <small>Message your team and agents</small>
                      </span>
                    </Link>
                  </div>
                </section>
              )
            default:
              return null
          }
        }

        return (
          <div className="app-page app-dashboard">
            <header className="app-dashboard-header">
              <div className="app-dashboard-heading">
                <ProjectSwitcher
                  projects={dashboard.projects}
                  onCreateProject={() => setNewProjectOpen(true)}
                />
                <p className="app-eyebrow">{dashboard.workspace.name}</p>
                <h1>Dashboard</h1>
                <p className="app-page-lede">
                  Welcome back, {dashboard.user.name ?? dashboard.user.email}. Here is what needs
                  attention across {dashboard.workspace.name}.
                </p>
              </div>
              <div className="app-dashboard-header-actions">
                <CopyButton
                  // Evaluated lazily on click so `window` is only touched in
                  // the browser; encodes the current widget/layout state.
                  text={() =>
                    dashboardShareHref(
                      { widgets: widgets.config, sort },
                      pathname,
                      window.location.search,
                    )
                  }
                  label="Copy link"
                />
                <Button type="button" variant="outline" onClick={() => setCustomizeOpen(true)}>
                  <SlidersHorizontal aria-hidden="true" />
                  Customize
                </Button>
                <Button type="button" onClick={() => setNewProjectOpen(true)}>
                  <Plus aria-hidden="true" />
                  New project
                </Button>
              </div>
            </header>

            <OnboardingResumeBanner />

            {widgets.isVisible("stats") && (
              <section className="app-stat-grid" aria-label="Workspace summary">
                <article className="app-stat-card">
                  <span className="app-stat-card-label">
                    <FolderKanban aria-hidden="true" />
                    Projects
                  </span>
                  <strong>{dashboard.projects.length}</strong>
                  <small>{totals.members} members across projects</small>
                </article>
                <article className="app-stat-card">
                  <span className="app-stat-card-label">
                    <HardDrive aria-hidden="true" />
                    Storage used
                  </span>
                  <strong>{formatBytes(dashboard.storage.usedBytes)}</strong>
                  <small>{formatBytes(dashboard.storage.availableBytes)} available</small>
                </article>
                <article className="app-stat-card">
                  <span className="app-stat-card-label">
                    <Bot aria-hidden="true" />
                    Agent runs
                  </span>
                  <strong>{totals.agentRuns}</strong>
                  <small>{totals.labSessions} lab sessions</small>
                </article>
              </section>
            )}

            {(widgets.isVisible("projects") ||
              widgets.config.order.some(
                (id) =>
                  (DASHBOARD_SIDEBAR_WIDGET_IDS as readonly string[]).includes(id) &&
                  widgets.isVisible(id),
              )) && (
              <div className="app-dashboard-columns">
                {widgets.isVisible("projects") && (
                  <section className="app-panel" aria-labelledby="projects-heading">
                    <div className="app-panel-head">
                      <div>
                        <h2 id="projects-heading">Projects</h2>
                        <p>Search, sort, and open a project home.</p>
                      </div>
                      <div className="app-toolbar">
                        <label className="app-search-field">
                          <Search aria-hidden="true" />
                          <span className="sr-only">Search projects</span>
                          <Input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search projects"
                            aria-label="Search projects"
                          />
                        </label>
                        <label className="app-sort-field">
                          <span className="sr-only">Sort projects</span>
                          <select
                            value={sort}
                            onChange={(event) => setSort(event.target.value as ProjectSort)}
                            aria-label="Sort projects"
                          >
                            {SORT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    {dashboard.projects.length === 0 ? (
                      <NoProjectsEmptyState
                        primaryAction={{
                          label: "New project",
                          onClick: () => setNewProjectOpen(true),
                        }}
                      />
                    ) : filteredProjects.length === 0 ? (
                      <SearchNoResultsEmptyState
                        query={search.trim()}
                        title="No matching projects"
                        description={`Nothing matches “${search.trim()}”. Try a different name, owner, or visibility.`}
                        primaryAction={{
                          label: "Clear search",
                          variant: "secondary",
                          onClick: () => setSearch(""),
                        }}
                      />
                    ) : (
                      <div className="app-project-grid">
                        {filteredProjects.map((project) => (
                          <ProjectCard key={project.id} project={project} />
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <div className="app-dashboard-side">
                  {sidebarWidgetOrder.map((id) => renderSidebarWidget(id))}
                </div>
              </div>
            )}

            <DashboardCustomizeDialog
              open={customizeOpen}
              onOpenChange={setCustomizeOpen}
              widgets={widgets}
            />
            <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
          </div>
        )
      }}
    </ScreenState>
  )
}
