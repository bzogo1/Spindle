"use client"

import { useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Bot,
  Files,
  FlaskConical,
  FolderKanban,
  HardDrive,
  Plus,
  Search,
  Sparkles,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { ScreenState } from "@/components/app/states/screen-state"
import { EmptyState } from "@/components/app/states/empty-state"
import { api, useMutation, useWorkspaceDashboard } from "@/lib/api"
import type { CreateProjectInput, ProjectSummary } from "@/lib/api/types"

import { formatBytes, formatRelativeTime } from "./format"

type ProjectSort = "updated" | "name" | "created" | "files"

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

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link href={`/projects/${project.id}`} className="app-project-card">
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
    </Link>
  )
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const createProject = useMutation((input: CreateProjectInput) =>
    api.projects.createProject(input),
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const project = await createProject.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setName("")
      setDescription("")
      onOpenChange(false)
      router.push(`/projects/${project.id}`)
    } catch {
      // The mutation state surfaces the error inside the dialog.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Create a mock project home with files, lab sessions, chat, and agent runs.
          </DialogDescription>
        </DialogHeader>
        <form className="app-form" onSubmit={submit}>
          <div className="app-field">
            <label htmlFor="new-project-name">Name</label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Coastal resilience"
              required
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="app-field">
            <label htmlFor="new-project-description">Description</label>
            <textarea
              id="new-project-description"
              className="app-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project for?"
              rows={3}
              maxLength={240}
            />
          </div>
          {createProject.error ? (
            <p className="app-form-error" role="alert">
              {createProject.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={createProject.isLoading || !name.trim()}>
              {createProject.isLoading ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DashboardScreen() {
  const query = useWorkspaceDashboard()
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<ProjectSort>("updated")
  const [newProjectOpen, setNewProjectOpen] = useState(false)

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
      files: projects.reduce((total, project) => total + project.fileCount, 0),
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
      {(dashboard) => (
        <div className="app-page app-dashboard">
          <header className="app-dashboard-header">
            <div className="app-dashboard-heading">
              <p className="app-eyebrow">{dashboard.workspace.name}</p>
              <h1>Dashboard</h1>
              <p className="app-page-lede">
                Welcome back, {dashboard.user.name ?? dashboard.user.email}. Here is what needs
                attention across {dashboard.workspace.name}.
              </p>
            </div>
            <Button type="button" onClick={() => setNewProjectOpen(true)}>
              <Plus aria-hidden="true" />
              New project
            </Button>
          </header>

          <section className="app-stat-grid" aria-label="Workspace summary">
            <article className="app-stat-card">
              <span>Projects</span>
              <strong>{dashboard.projects.length}</strong>
              <small>{totals.members} members across projects</small>
            </article>
            <article className="app-stat-card">
              <span>Files</span>
              <strong>{totals.files}</strong>
              <small>{formatBytes(dashboard.storage.fileBytes)} stored</small>
            </article>
            <article className="app-stat-card">
              <span>Lab sessions</span>
              <strong>{totals.labSessions}</strong>
              <small>{totals.agentRuns} agent runs</small>
            </article>
            <article className="app-stat-card">
              <span>Storage</span>
              <strong>{formatBytes(dashboard.storage.usedBytes)}</strong>
              <small>{formatBytes(dashboard.storage.availableBytes)} available</small>
            </article>
          </section>

          <div className="app-dashboard-columns">
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
                  body={`Nothing matches “${search.trim()}”. Try a different name, owner, or visibility.`}
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

            <div className="app-dashboard-side">
              <section className="app-panel" aria-labelledby="activity-heading">
                <div className="app-panel-head">
                  <div>
                    <h2 id="activity-heading">Recent activity</h2>
                    <p>Latest project, file, lab, chat, and agent events.</p>
                  </div>
                </div>
                {dashboard.activity.length === 0 ? (
                  <EmptyState
                    title="No recent activity"
                    body="Activity will appear here as projects, files, runs, and sessions change."
                    primaryAction={{
                      label: "New project",
                      onClick: () => setNewProjectOpen(true),
                    }}
                  />
                ) : (
                  <ol className="app-activity-list">
                    {dashboard.activity.map((event) => (
                      <li key={event.id}>
                        <span className={`app-activity-kind is-${event.kind}`}>{event.kind}</span>
                        <div>
                          <p>
                            <strong>{event.actor.name}</strong> {event.summary}
                            {event.target ? ` ${event.target}` : ""}
                          </p>
                          <small>
                            {event.projectId ? (
                              <Link href={`/projects/${event.projectId}`}>
                                {event.projectName ?? "Project"}
                              </Link>
                            ) : (
                              (event.projectName ?? "Workspace")
                            )}
                            {" · "}
                            {formatRelativeTime(event.createdAt)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="app-panel" aria-labelledby="storage-heading">
                <div className="app-panel-head">
                  <div>
                    <h2 id="storage-heading">Storage</h2>
                    <p>Workspace files and compute checkpoints.</p>
                  </div>
                  <HardDrive aria-hidden="true" className="app-panel-icon" />
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

              <section className="app-panel" aria-labelledby="quick-links-heading">
                <div className="app-panel-head">
                  <div>
                    <h2 id="quick-links-heading">Quick links</h2>
                    <p>Jump into the workspace tools.</p>
                  </div>
                </div>
                <nav className="app-quick-links" aria-label="Workspace quick links">
                  <Link href="/app/files" className="app-quick-link">
                    <Files aria-hidden="true" />
                    <span>
                      <strong>Files</strong>
                      <small>Browse project files</small>
                    </span>
                  </Link>
                  <Link href="/app/lab" className="app-quick-link">
                    <FlaskConical aria-hidden="true" />
                    <span>
                      <strong>Lab</strong>
                      <small>Open compute sessions</small>
                    </span>
                  </Link>
                  <Link href="/app/agent" className="app-quick-link">
                    <Bot aria-hidden="true" />
                    <span>
                      <strong>Agent</strong>
                      <small>Review runs and diffs</small>
                    </span>
                  </Link>
                  <Link href="/app/chat" className="app-quick-link">
                    <Sparkles aria-hidden="true" />
                    <span>
                      <strong>Chat</strong>
                      <small>Project conversations</small>
                    </span>
                  </Link>
                </nav>
              </section>
            </div>
          </div>

          <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
        </div>
      )}
    </ScreenState>
  )
}
