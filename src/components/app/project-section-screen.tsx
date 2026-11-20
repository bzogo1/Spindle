"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Files, FlaskConical, FolderKanban, MessageSquare } from "lucide-react"

import { LoadingPanel } from "@/components/app/states/loading-panel"
import { QueryState } from "@/components/app/states/query-state"
import { Button } from "@/components/ui/button"
import { useWorkspaceDashboard } from "@/lib/api"
import type { ProjectSummary } from "@/lib/api/types"

export type ProjectSection = "lab" | "chat" | "files"

interface SectionConfig {
  label: string
  icon: React.ReactNode
  body: string
  href: (projectId: string) => string
}

const SECTION_CONFIG: Record<ProjectSection, SectionConfig> = {
  lab: {
    label: "Lab",
    icon: <FlaskConical aria-hidden="true" />,
    body: "Notebooks, scripts, and live computations live inside a project. Pick one to open its lab.",
    href: (projectId) => `/projects/${projectId}/lab`,
  },
  chat: {
    label: "Chat",
    icon: <MessageSquare aria-hidden="true" />,
    body: "Conversations are scoped to a project. Pick one to open its chat channels.",
    href: (projectId) => `/projects/${projectId}/chat`,
  },
  files: {
    label: "Files",
    icon: <Files aria-hidden="true" />,
    body: "Each project has its own file library. Pick a project to browse its files and folders.",
    href: (projectId) => `/projects/${projectId}/files`,
  },
}

/**
 * Workspace-level entry point for the project-scoped screens (lab, chat,
 * files). These surfaces only exist per project, so the `/app/*` routes show
 * a picker that links into `/projects/[projectId]/*` instead of dead-ending.
 */
export function ProjectSectionScreen({ section }: { section: ProjectSection }) {
  const config = SECTION_CONFIG[section]
  const query = useWorkspaceDashboard()
  const projects = query.data?.projects ?? []

  return (
    <QueryState<ProjectSummary[]>
      status={query.status}
      data={projects}
      error={query.error}
      isEmpty={projects.length === 0}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
      loading={<LoadingPanel label={`Loading ${config.label.toLowerCase()}`} variant="cards" />}
      emptyIcon={config.icon}
      emptyTitle="No projects yet"
      emptyBody={`${config.label} is scoped to a project. Create a project first, then come back to pick it here.`}
      primaryAction={{ label: "Go to projects", href: "/projects" }}
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard", variant: "outline" }}
      errorTitle="Projects did not load"
      errorMessage={`We could not load your projects, so ${config.label.toLowerCase()} cannot be opened. Try again to refresh the list.`}
    >
      {(items) => (
        // `useSearchParams` suspends to the nearest boundary during prerender;
        // the layout is dynamic, but the boundary keeps the picker resilient.
        <Suspense
          fallback={
            <LoadingPanel label={`Loading ${config.label.toLowerCase()}`} variant="cards" />
          }
        >
          <ProjectSectionPicker config={config} projects={items} />
        </Suspense>
      )}
    </QueryState>
  )
}

/**
 * Project list plus a shortcut into the section. A `?project=<id>` search param
 * matching a loaded project (the same convention as the project switcher) gets
 * a prominent "open" action; with exactly one project the same shortcut is
 * offered so users do not have to click through a one-item list. Unknown or
 * missing params are ignored and the plain picker renders.
 */
function ProjectSectionPicker({
  config,
  projects,
}: {
  config: SectionConfig
  projects: ProjectSummary[]
}) {
  const searchParams = useSearchParams()
  const requested = projects.find((project) => project.id === searchParams.get("project"))
  const featured = requested ?? (projects.length === 1 ? projects[0] : undefined)

  return (
    <section className="app-panel" aria-labelledby="project-picker-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="project-picker-heading">Choose a project</h2>
          <p>{config.body}</p>
        </div>
        <Link className="app-panel-link" href="/projects">
          All projects
        </Link>
      </div>
      {featured ? (
        <div className="app-project-actions">
          <Button asChild>
            <Link href={config.href(featured.id)}>
              {config.icon}
              Open {featured.name} {config.label.toLowerCase()}
            </Link>
          </Button>
        </div>
      ) : null}
      <ul className="app-file-list">
        {projects.map((project) => (
          <li key={project.id}>
            <Link href={config.href(project.id)} className="app-file-row">
              <span className="app-file-icon" aria-hidden="true">
                <FolderKanban />
              </span>
              <span className="app-file-main">
                <strong>{project.name}</strong>
                <small>{project.description ?? project.slug}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
