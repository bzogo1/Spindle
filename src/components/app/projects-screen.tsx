"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Archive,
  ArchiveRestore,
  Copy,
  FolderKanban,
  History,
  LayoutGrid,
  List,
  Plus,
  Search,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { api, useMutation, useWorkspaceDashboard } from "@/lib/api"
import { mergeActivityEvents } from "@/lib/activity/client"
import { useActivityEvents } from "@/lib/activity/use-activity-events"
import type { ProjectStatus, ProjectSummary, User } from "@/lib/api/types"

import { ActivityFeed } from "./activity-feed"
import { NewProjectDialog } from "./new-project-dialog"
import { orderByManual, useProjectDragOrder, type ProjectDragBinding } from "./project-order"

import { formatBytes, formatRelativeTime } from "./format"
import { NavLink } from "@/components/view-transitions/nav-link"
import { SharedElement } from "@/components/view-transitions/view-transitions"
import { viewTransitionName } from "@/components/view-transitions/vt-support"

type ProjectSort = "updated" | "name" | "created" | "files" | "storage"
type ViewMode = "grid" | "list"
type StatusFilter = ProjectStatus | "all"

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: "updated", label: "Recently active" },
  { value: "name", label: "Name" },
  { value: "created", label: "Recently created" },
  { value: "files", label: "Most files" },
  { value: "storage", label: "Storage used" },
]

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
]

const VIEW_STORAGE_KEY = "spindle.projects.view"
const PROJECT_ORDER_STORAGE_KEY = "spindle.projects.order"

const PROJECT_QUICK_ACTIONS = [
  { label: "Files", href: (id: string) => `/projects/${id}/files` },
  { label: "Lab", href: (id: string) => `/projects/${id}/lab` },
  { label: "Chat", href: (id: string) => `/projects/${id}/chat` },
] as const

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
    project.status,
    ...(project.members ?? []).map((member) => member.name ?? member.email),
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
    if (sort === "storage") {
      return b.storageBytes - a.storageBytes || a.name.localeCompare(b.name)
    }
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

function ProjectMeta({ project }: { project: ProjectSummary }) {
  return (
    <dl className="app-project-card-meta">
      <div>
        <dt>Files</dt>
        <dd>{project.fileCount}</dd>
      </div>
      <div>
        <dt>Last activity</dt>
        <dd>{formatRelativeTime(projectTimestamp(project))}</dd>
      </div>
      <div>
        <dt>Members</dt>
        <dd>{project.memberCount}</dd>
      </div>
      <div>
        <dt>Owner</dt>
        <dd>{userLabel(project.owner)}</dd>
      </div>
    </dl>
  )
}

function QuickActions({
  project,
  className = "app-project-card-actions",
  onClone,
  cloning,
  clonePending,
  onArchive,
  archiving,
  archivePending,
}: {
  project: ProjectSummary
  className?: string
  onClone: (project: ProjectSummary) => void
  cloning: boolean
  clonePending: boolean
  onArchive: (project: ProjectSummary) => void
  archiving: boolean
  archivePending: boolean
}) {
  const archived = project.status === "archived"
  return (
    <div className={className} aria-label={`Quick actions for ${project.name}`}>
      {PROJECT_QUICK_ACTIONS.map((action) => (
        <Link key={action.label} href={action.href(project.id)} className="app-card-action">
          {action.label}
        </Link>
      ))}
      <button
        type="button"
        className="app-card-action"
        onClick={() => onClone(project)}
        disabled={clonePending}
      >
        <Copy aria-hidden="true" />
        {cloning ? "Cloning…" : "Clone"}
      </button>
      <button
        type="button"
        className="app-card-action"
        onClick={() => onArchive(project)}
        disabled={archivePending}
      >
        {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
        {archiving ? (archived ? "Restoring…" : "Archiving…") : archived ? "Restore" : "Archive"}
      </button>
    </div>
  )
}

function projectCardClass(project: ProjectSummary, drag?: ProjectDragBinding) {
  return [
    "app-project-card",
    project.status === "archived" ? "app-project-card--archived" : null,
    drag?.dragging ? "app-project-card--dragging" : null,
    drag?.dropTarget ? "app-project-card--drop-target" : null,
  ]
    .filter(Boolean)
    .join(" ")
}

function projectRowClass(project: ProjectSummary, drag?: ProjectDragBinding) {
  return [
    "app-project-row",
    project.status === "archived" ? "app-project-row--archived" : null,
    drag?.dragging ? "app-project-row--dragging" : null,
    drag?.dropTarget ? "app-project-row--drop-target" : null,
  ]
    .filter(Boolean)
    .join(" ")
}

function ProjectCard({
  project,
  onClone,
  cloning,
  clonePending,
  onArchive,
  archiving,
  archivePending,
  drag,
}: {
  project: ProjectSummary
  onClone: (project: ProjectSummary) => void
  cloning: boolean
  clonePending: boolean
  onArchive: (project: ProjectSummary) => void
  archiving: boolean
  archivePending: boolean
  drag?: ProjectDragBinding
}) {
  // The title morphs into the project header on the detail page — the name
  // must match `project-home-screen.tsx` exactly.
  const titleTransitionName = viewTransitionName("project", project.id)
  const archived = project.status === "archived"
  const dragHandlers = drag
    ? {
        draggable: drag.draggable,
        onDragStart: drag.onDragStart,
        onDragOver: drag.onDragOver,
        onDrop: drag.onDrop,
        onDragEnd: drag.onDragEnd,
      }
    : {}
  return (
    <article className={projectCardClass(project, drag)} {...dragHandlers}>
      <NavLink href={`/projects/${project.id}`} className="app-project-card-open">
        <div className="app-project-card-head">
          <span className="app-project-card-icon" aria-hidden="true">
            <FolderKanban />
          </span>
          <span className="app-project-card-badges">
            {archived ? (
              <Badge variant="outline" className="app-project-status">
                Archived
              </Badge>
            ) : null}
            <Badge variant="outline" className="app-project-visibility">
              {project.visibility}
            </Badge>
          </span>
        </div>
        <SharedElement name={titleTransitionName}>
          <h3>{project.name}</h3>
        </SharedElement>
        <p>{project.description ?? "No description yet."}</p>
        <ProjectMeta project={project} />
        <div className="app-project-card-members">
          <MemberStack project={project} />
        </div>
      </NavLink>
      <QuickActions
        project={project}
        onClone={onClone}
        cloning={cloning}
        clonePending={clonePending}
        onArchive={onArchive}
        archiving={archiving}
        archivePending={archivePending}
      />
    </article>
  )
}

function ProjectRow({
  project,
  onClone,
  cloning,
  clonePending,
  onArchive,
  archiving,
  archivePending,
  drag,
}: {
  project: ProjectSummary
  onClone: (project: ProjectSummary) => void
  cloning: boolean
  clonePending: boolean
  onArchive: (project: ProjectSummary) => void
  archiving: boolean
  archivePending: boolean
  drag?: ProjectDragBinding
}) {
  const titleTransitionName = viewTransitionName("project", project.id)
  const archived = project.status === "archived"
  const dragHandlers = drag
    ? {
        draggable: drag.draggable,
        onDragStart: drag.onDragStart,
        onDragOver: drag.onDragOver,
        onDrop: drag.onDrop,
        onDragEnd: drag.onDragEnd,
      }
    : {}
  return (
    <article className={projectRowClass(project, drag)} {...dragHandlers}>
      <NavLink href={`/projects/${project.id}`} className="app-project-row-open">
        <span className="app-project-card-icon" aria-hidden="true">
          <FolderKanban />
        </span>
        <span className="app-project-row-main">
          <span className="app-project-row-title">
            <SharedElement name={titleTransitionName}>
              <strong>{project.name}</strong>
            </SharedElement>
            {archived ? (
              <Badge variant="outline" className="app-project-status">
                Archived
              </Badge>
            ) : null}
            <Badge variant="outline" className="app-project-visibility">
              {project.visibility}
            </Badge>
          </span>
          <small>{project.description ?? "No description yet."}</small>
          <span className="app-project-row-meta">
            <span>{userLabel(project.owner)}</span>
            <span aria-hidden="true">·</span>
            <span>{project.memberCount} members</span>
            <span aria-hidden="true">·</span>
            <span>{project.fileCount} files</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(project.storageBytes)}</span>
          </span>
        </span>
        <span className="app-project-row-side">
          <MemberStack project={project} />
          <span className="app-project-row-time">
            {formatRelativeTime(projectTimestamp(project))}
          </span>
        </span>
      </NavLink>
      <QuickActions
        project={project}
        className="app-project-row-actions"
        onClone={onClone}
        cloning={cloning}
        clonePending={clonePending}
        onArchive={onArchive}
        archiving={archiving}
        archivePending={archivePending}
      />
    </article>
  )
}

function NewProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="app-project-card app-project-card--new" onClick={onClick}>
      <span className="app-project-card-new-icon" aria-hidden="true">
        <Plus />
      </span>
      <span className="app-project-card-new-label">New project</span>
      <span className="app-project-card-new-hint">Start a new project home</span>
    </button>
  )
}

function NewProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="app-project-row app-project-row--new" onClick={onClick}>
      <span className="app-project-card-icon" aria-hidden="true">
        <Plus />
      </span>
      <span className="app-project-row-main">
        <strong>New project</strong>
        <small>Start a new project home</small>
      </span>
    </button>
  )
}

export function ProjectsScreen() {
  const query = useWorkspaceDashboard()
  // Workspace-wide live activity (no project filter) merged into the feed —
  // the same channel the dashboard activity widget uses.
  const liveActivity = useActivityEvents()
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [ownerFilter, setOwnerFilter] = useState<string>("all")
  const [sort, setSort] = useState<ProjectSort>("updated")
  const [view, setView] = useState<ViewMode>("grid")
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const cloneProject = useMutation((project: ProjectSummary) =>
    api.projects.createProject({
      name: `${project.name} (copy)`,
      description: project.description,
      templateId: project.templateId,
      cloneFromProjectId: project.id,
    }),
  )
  const setProjectStatus = useMutation((input: { id: string; status: ProjectStatus }) =>
    api.projects.updateProject(input.id, { status: input.status }),
  )
  // Manual drag-and-drop order layered on top of the active sort; persisted
  // to localStorage so it survives reloads (no backend field yet).
  const dragOrder = useProjectDragOrder(PROJECT_ORDER_STORAGE_KEY)

  // Restore the persisted view preference after mount (localStorage is not
  // available during SSR, so the first paint always uses the grid default).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "list") setView("list")
    } catch {
      // Storage can be unavailable (private mode).
    }
  }, [])

  function changeView(next: ViewMode) {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable (private mode).
    }
  }

  const ownerOptions = useMemo(() => {
    const owners = new Map<string, User>()
    for (const project of query.data?.projects ?? []) {
      if (!owners.has(project.owner.id)) owners.set(project.owner.id, project.owner)
    }
    return [...owners.values()].sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
  }, [query.data?.projects])

  const filteredProjects = useMemo(() => {
    if (!query.data) return []
    const normalized = search.trim().toLowerCase()
    return sortProjects(
      query.data.projects.filter(
        (project) =>
          matchesQuery(project, normalized) &&
          (statusFilter === "all" || project.status === statusFilter) &&
          (ownerFilter === "all" || project.owner.id === ownerFilter),
      ),
      sort,
    )
  }, [query.data, search, statusFilter, ownerFilter, sort])

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || ownerFilter !== "all"

  // Displayed projects: the active sort first, then any manual drag order
  // the user has arranged on top of it.
  const visibleProjects = useMemo(
    () => orderByManual(filteredProjects, dragOrder.order),
    [filteredProjects, dragOrder.order],
  )
  const displayedIds = useMemo(
    () => visibleProjects.map((project) => project.id),
    [visibleProjects],
  )

  function handleSortChange(next: ProjectSort) {
    setSort(next)
    // A different sort invalidates the manual arrangement.
    dragOrder.reset()
  }

  function clearFilters() {
    setSearch("")
    setStatusFilter("all")
    setOwnerFilter("all")
  }

  async function handleClone(project: ProjectSummary) {
    if (cloningId) return
    setCloningId(project.id)
    try {
      const copy = await cloneProject.mutate(project)
      toast({
        title: "Project cloned",
        description: `${copy.name} is ready to use.`,
        variant: "success",
      })
      router.push(`/projects/${copy.id}`)
    } catch (error) {
      toast({
        variant: "error",
        title: "Couldn't clone project",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setCloningId(null)
    }
  }

  async function handleArchive(project: ProjectSummary) {
    if (archivingId) return
    const archived = project.status !== "archived"
    setArchivingId(project.id)
    try {
      await setProjectStatus.mutate({ id: project.id, status: archived ? "archived" : "active" })
      toast({
        title: archived ? "Project archived" : "Project restored",
        description: archived
          ? `${project.name} was moved to the archive. You can restore it anytime.`
          : `${project.name} is active again.`,
        variant: "success",
      })
      query.refetch()
    } catch (error) {
      toast({
        variant: "error",
        title: archived ? "Couldn't archive project" : "Couldn't restore project",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <ScreenState
      screen="projects"
      status={query.status}
      data={query.data}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    >
      {(dashboard) => {
        const activity = mergeActivityEvents(dashboard.activity, liveActivity)
        return (
          <div className="app-page">
            <header className="app-dashboard-header">
              <div className="app-dashboard-heading">
                <p className="app-eyebrow">{dashboard.workspace.name}</p>
                <h1 className="app-page-title">Projects</h1>
                <p className="app-page-lede">Browse every project in {dashboard.workspace.name}.</p>
              </div>
              <Button type="button" onClick={() => setNewProjectOpen(true)}>
                <Plus aria-hidden="true" />
                New project
              </Button>
            </header>

            <section className="app-panel" aria-labelledby="projects-heading">
              <div className="app-panel-head">
                <div>
                  <h2 id="projects-heading">All projects</h2>
                  <p>Search, filter, and sort the project list.</p>
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
                    <span className="sr-only">Filter by status</span>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                      aria-label="Filter by status"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="app-sort-field">
                    <span className="sr-only">Filter by owner</span>
                    <select
                      value={ownerFilter}
                      onChange={(event) => setOwnerFilter(event.target.value)}
                      aria-label="Filter by owner"
                    >
                      <option value="all">All owners</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {userLabel(owner)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="app-sort-field">
                    <span className="sr-only">Sort projects</span>
                    <select
                      value={sort}
                      onChange={(event) => handleSortChange(event.target.value as ProjectSort)}
                      aria-label="Sort projects"
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="app-view-toggle" role="group" aria-label="Project view">
                    <button
                      type="button"
                      aria-pressed={view === "grid"}
                      aria-label="Grid view"
                      title="Grid view"
                      onClick={() => changeView("grid")}
                    >
                      <LayoutGrid aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "list"}
                      aria-label="List view"
                      title="List view"
                      onClick={() => changeView("list")}
                    >
                      <List aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              {dashboard.projects.length === 0 ? (
                <EmptyState
                  icon={<FolderKanban aria-hidden="true" />}
                  title="No projects yet"
                  body="Create a project to start collecting files, running lab sessions, and working with the agent."
                  primaryAction={{
                    label: "New project",
                    onClick: () => setNewProjectOpen(true),
                  }}
                />
              ) : filteredProjects.length === 0 ? (
                <EmptyState
                  title="No matching projects"
                  body={
                    hasActiveFilters
                      ? "Nothing matches the current search and filters. Try adjusting or clearing them."
                      : `Nothing matches “${search.trim()}”. Try a different name, owner, or visibility.`
                  }
                  primaryAction={{
                    label: "Clear filters",
                    variant: "secondary",
                    onClick: clearFilters,
                  }}
                />
              ) : view === "grid" ? (
                <div className="app-project-grid">
                  {visibleProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClone={handleClone}
                      cloning={cloningId === project.id}
                      clonePending={cloningId !== null}
                      onArchive={handleArchive}
                      archiving={archivingId === project.id}
                      archivePending={archivingId !== null}
                      drag={dragOrder.bind(project.id, displayedIds)}
                    />
                  ))}
                  <NewProjectCard onClick={() => setNewProjectOpen(true)} />
                </div>
              ) : (
                <div className="app-project-list">
                  {visibleProjects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      onClone={handleClone}
                      cloning={cloningId === project.id}
                      clonePending={cloningId !== null}
                      onArchive={handleArchive}
                      archiving={archivingId === project.id}
                      archivePending={archivingId !== null}
                      drag={dragOrder.bind(project.id, displayedIds)}
                    />
                  ))}
                  <NewProjectRow onClick={() => setNewProjectOpen(true)} />
                </div>
              )}
            </section>

            <section className="app-panel" aria-labelledby="projects-activity-heading">
              <div className="app-panel-head">
                <div>
                  <h2 id="projects-activity-heading">Activity across projects</h2>
                  <p>
                    Recent events from every project in {dashboard.workspace.name}, newest first.
                  </p>
                </div>
                <History aria-hidden="true" className="app-panel-icon" />
              </div>
              {activity.length === 0 ? (
                <EmptyState
                  icon={<History aria-hidden="true" />}
                  title="No recent activity"
                  body="Project events will appear here as files, sessions, messages, and runs change."
                />
              ) : (
                <ActivityFeed events={activity} groupByDay pageSize={10} />
              )}
            </section>

            <NewProjectDialog
              open={newProjectOpen}
              onOpenChange={setNewProjectOpen}
              onCreated={(project) =>
                toast({
                  title: "Project created",
                  description: `${project.name} is ready to use.`,
                  variant: "success",
                })
              }
            />
          </div>
        )
      }}
    </ScreenState>
  )
}
