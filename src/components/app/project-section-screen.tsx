"use client"

import { Suspense, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Download, Files, FlaskConical, FolderKanban, MessageSquare, Search } from "lucide-react"

import { LoadingPanel } from "@/components/app/states/loading-panel"
import { QueryState } from "@/components/app/states/query-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFiles, useLabSessions, useProjectHome, useWorkspaceDashboard } from "@/lib/api"
import type { ChatMessage, LabSession, ProjectFile, ProjectSummary } from "@/lib/api/types"

import { formatBytes, formatDate } from "./format"

export type ProjectSection = "lab" | "chat" | "files"

interface SectionConfig {
  label: string
  icon: React.ReactNode
  body: string
  href: (projectId: string) => string
  searchPlaceholder: string
  emptyTitle: string
  emptyBody: string
}

const SECTION_CONFIG: Record<ProjectSection, SectionConfig> = {
  lab: {
    label: "Lab",
    icon: <FlaskConical aria-hidden="true" />,
    body: "Notebooks, scripts, and live computations live inside a project. Pick one to open its lab.",
    href: (projectId) => `/projects/${projectId}/lab`,
    searchPlaceholder: "Search sessions",
    emptyTitle: "No lab sessions yet",
    emptyBody: "This project has no lab sessions. Start one from the project's Lab tab.",
  },
  chat: {
    label: "Chat",
    icon: <MessageSquare aria-hidden="true" />,
    body: "Conversations are scoped to a project. Pick one to open its chat channels.",
    href: (projectId) => `/projects/${projectId}/chat`,
    searchPlaceholder: "Search messages",
    emptyTitle: "No messages yet",
    emptyBody:
      "This project has no chat messages. Start a conversation from the project's Chat tab.",
  },
  files: {
    label: "Files",
    icon: <Files aria-hidden="true" />,
    body: "Each project has its own file library. Pick a project to browse its files and folders.",
    href: (projectId) => `/projects/${projectId}/files`,
    searchPlaceholder: "Search files",
    emptyTitle: "No files yet",
    emptyBody: "This project has no files. Upload one from the project's Files tab.",
  },
}

/** One normalized row of section data, ready for search, listing, and export. */
interface SectionItem {
  id: string
  title: string
  detail?: string
  meta?: string
  /** Flat string map exported verbatim as CSV columns / JSON fields. */
  cells: Record<string, string>
  /** Lowercased haystack the search input filters against. */
  searchText: string
}

interface SectionColumn {
  key: string
  label: string
}

type SectionQueryStatus = "loading" | "error" | "success"

const FILE_COLUMNS: SectionColumn[] = [
  { key: "name", label: "Name" },
  { key: "path", label: "Path" },
  { key: "sizeBytes", label: "Size (bytes)" },
  { key: "mimeType", label: "MIME type" },
  { key: "createdAt", label: "Created at" },
]

const LAB_COLUMNS: SectionColumn[] = [
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created at" },
  { key: "endedAt", label: "Ended at" },
]

const CHAT_COLUMNS: SectionColumn[] = [
  { key: "role", label: "Role" },
  { key: "content", label: "Content" },
  { key: "createdAt", label: "Created at" },
]

function fileToSectionItem(file: ProjectFile): SectionItem {
  return {
    id: file.id,
    title: file.name,
    detail: file.path,
    meta: `${formatBytes(file.sizeBytes)} · ${formatDate(file.createdAt)}`,
    cells: {
      name: file.name,
      path: file.path,
      sizeBytes: String(file.sizeBytes),
      mimeType: file.mimeType ?? "",
      createdAt: file.createdAt,
    },
    searchText: `${file.name} ${file.path} ${file.mimeType ?? ""}`.toLowerCase(),
  }
}

function labSessionToSectionItem(session: LabSession): SectionItem {
  return {
    id: session.id,
    title: session.title,
    detail: session.status,
    meta: `${formatDate(session.createdAt)}${session.endedAt ? ` → ${formatDate(session.endedAt)}` : ""}`,
    cells: {
      title: session.title,
      status: session.status,
      createdAt: session.createdAt,
      endedAt: session.endedAt ?? "",
    },
    searchText: `${session.title} ${session.status}`.toLowerCase(),
  }
}

function chatMessageToSectionItem(message: ChatMessage): SectionItem {
  const preview =
    message.content.length > 120 ? `${message.content.slice(0, 120)}…` : message.content
  return {
    id: message.id,
    title: preview,
    detail: message.role,
    meta: formatDate(message.createdAt),
    cells: {
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    },
    searchText: `${message.role} ${message.content}`.toLowerCase(),
  }
}

function csvCell(cell: string) {
  return `"${cell.replaceAll('"', '""')}"`
}

/** Section export payload as CSV: one row per item, columns in `columns` order. */
function sectionExportCsv(columns: SectionColumn[], items: SectionItem[]): string {
  const rows = [
    columns.map((column) => column.key),
    ...items.map((item) => columns.map((column) => item.cells[column.key] ?? "")),
  ]
  return rows.map((row) => row.map(csvCell).join(",")).join("\n")
}

/** Same section data as JSON: one object per item keyed by column key. */
function sectionExportJson(columns: SectionColumn[], items: SectionItem[]): string {
  return JSON.stringify(
    items.map((item) =>
      Object.fromEntries(columns.map((column) => [column.key, item.cells[column.key] ?? ""])),
    ),
    null,
    2,
  )
}

function downloadSectionExport(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Dynamic section panel: once a project is picked it fetches that project's
 * section data (files, lab sessions, or chat messages), filters it with the
 * search input, and exports the filtered result as CSV or JSON.
 */
function SectionExplorerFrame({
  section,
  config,
  project,
  columns,
  items,
  status,
  error,
  isRetrying,
  onRetry,
}: {
  section: ProjectSection
  config: SectionConfig
  project: ProjectSummary
  columns: SectionColumn[]
  items: SectionItem[] | undefined
  status: SectionQueryStatus
  error?: unknown
  isRetrying: boolean
  onRetry: () => void
}) {
  const [search, setSearch] = useState("")
  const term = search.trim().toLowerCase()
  const headingId = `project-section-${section}-heading`

  return (
    <section className="app-panel" aria-labelledby={headingId}>
      <QueryState<SectionItem[]>
        status={status}
        data={items}
        error={error}
        isEmpty={(items ?? []).length === 0}
        isRetrying={isRetrying}
        onRetry={onRetry}
        loading={<LoadingPanel label={`Loading ${config.label.toLowerCase()}`} variant="cards" />}
        emptyIcon={config.icon}
        emptyTitle={config.emptyTitle}
        emptyBody={config.emptyBody}
        errorTitle={`${config.label} did not load`}
        errorMessage={`We could not load ${config.label.toLowerCase()} for ${project.name}. Try again to refresh.`}
      >
        {(allItems) => {
          const filtered = term
            ? allItems.filter((item) => item.searchText.includes(term))
            : allItems
          const filenameBase = `spindle-${section}-${project.id}`
          return (
            <>
              <div className="app-panel-head">
                <div>
                  <h2 id={headingId}>
                    {config.label} in {project.name}
                  </h2>
                  <p>
                    {term ? (
                      <>
                        {filtered.length} of {allItems.length}{" "}
                        {allItems.length === 1 ? "item" : "items"} match &ldquo;
                        {search.trim()}&rdquo;
                      </>
                    ) : (
                      <>
                        {allItems.length} {allItems.length === 1 ? "item" : "items"}
                      </>
                    )}
                  </p>
                </div>
                <div className="app-panel-head-actions">
                  <label className="app-search-field">
                    <Search aria-hidden="true" />
                    <span className="sr-only">Search {config.label.toLowerCase()}</span>
                    <Input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setSearch("")
                      }}
                      placeholder={config.searchPlaceholder}
                      aria-label={`Search ${config.label.toLowerCase()} in ${project.name}`}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filtered.length === 0}
                    onClick={() =>
                      downloadSectionExport(
                        `${filenameBase}.csv`,
                        sectionExportCsv(columns, filtered),
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    <Download aria-hidden="true" />
                    Export CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filtered.length === 0}
                    onClick={() =>
                      downloadSectionExport(
                        `${filenameBase}.json`,
                        sectionExportJson(columns, filtered),
                        "application/json",
                      )
                    }
                  >
                    <Download aria-hidden="true" />
                    Export JSON
                  </Button>
                  <Link className="app-panel-link" href={config.href(project.id)}>
                    Open full {config.label.toLowerCase()}
                  </Link>
                </div>
              </div>
              {filtered.length === 0 ? (
                <p className="app-field-hint">
                  No {config.label.toLowerCase()} match &ldquo;{search.trim()}&rdquo;. Try a
                  different search.
                </p>
              ) : (
                <ul className="app-file-list">
                  {filtered.map((item) => (
                    <li key={item.id}>
                      <div className="app-file-row">
                        <span className="app-file-icon" aria-hidden="true">
                          {config.icon}
                        </span>
                        <span className="app-file-main">
                          <strong>{item.title}</strong>
                          {item.detail ? <small>{item.detail}</small> : null}
                        </span>
                        {item.meta ? (
                          <span className="app-file-meta">
                            <span>{item.meta}</span>
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        }}
      </QueryState>
    </section>
  )
}

function FilesSectionExplorer({ project }: { project: ProjectSummary }) {
  const query = useFiles(project.id)
  const items = useMemo(() => (query.data ?? []).map(fileToSectionItem), [query.data])
  return (
    <SectionExplorerFrame
      section="files"
      config={SECTION_CONFIG.files}
      project={project}
      columns={FILE_COLUMNS}
      items={items}
      status={query.status === "idle" ? "loading" : query.status}
      error={query.error ?? undefined}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    />
  )
}

function LabSectionExplorer({ project }: { project: ProjectSummary }) {
  const query = useLabSessions(project.id)
  const items = useMemo(() => (query.data ?? []).map(labSessionToSectionItem), [query.data])
  return (
    <SectionExplorerFrame
      section="lab"
      config={SECTION_CONFIG.lab}
      project={project}
      columns={LAB_COLUMNS}
      items={items}
      status={query.status === "idle" ? "loading" : query.status}
      error={query.error ?? undefined}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    />
  )
}

function ChatSectionExplorer({ project }: { project: ProjectSummary }) {
  // Chat messages are keyed by conversation; the project home payload carries
  // both the conversation id and its messages for the project.
  const query = useProjectHome(project.id)
  const items = useMemo(
    () => (query.data?.chatMessages ?? []).map(chatMessageToSectionItem),
    [query.data],
  )
  return (
    <SectionExplorerFrame
      section="chat"
      config={SECTION_CONFIG.chat}
      project={project}
      columns={CHAT_COLUMNS}
      items={items}
      status={query.status}
      error={query.error}
      isRetrying={query.isRetrying}
      onRetry={query.refetch}
    />
  )
}

/** Routes a section to the hook-backed explorer that loads its data. */
function ProjectSectionExplorer({
  section,
  project,
}: {
  section: ProjectSection
  project: ProjectSummary
}) {
  if (section === "files") return <FilesSectionExplorer project={project} />
  if (section === "lab") return <LabSectionExplorer project={project} />
  return <ChatSectionExplorer project={project} />
}

/**
 * Workspace-level entry point for the project-scoped screens (lab, chat,
 * files). These surfaces only exist per project, so the `/app/*` routes show
 * a picker that links into `/projects/[projectId]/*` instead of dead-ending.
 * Picking a project (or following a `?project=<id>` link) also loads that
 * project's section data inline — searchable and exportable — via
 * `ProjectSectionExplorer`.
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
          <ProjectSectionPicker section={section} config={config} projects={items} />
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
 * missing params are ignored and the plain picker renders. The select below
 * the list chooses which project's section data loads inline.
 */
function ProjectSectionPicker({
  section,
  config,
  projects,
}: {
  section: ProjectSection
  config: SectionConfig
  projects: ProjectSummary[]
}) {
  const searchParams = useSearchParams()
  const requested = projects.find((project) => project.id === searchParams.get("project"))
  const featured = requested ?? (projects.length === 1 ? projects[0] : undefined)
  const [previewId, setPreviewId] = useState<string>(featured?.id ?? "")
  const previewProject = projects.find((project) => project.id === previewId)

  return (
    <>
      <section className="app-panel" aria-labelledby="project-picker-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="project-picker-heading">Choose a project</h2>
            <p>{config.body}</p>
          </div>
          <div className="app-panel-head-actions">
            <label className="app-sort-field">
              <span className="sr-only">Preview section for a project</span>
              <select
                value={previewId}
                onChange={(event) => setPreviewId(event.target.value)}
                aria-label={`Preview ${config.label.toLowerCase()} for a project`}
              >
                <option value="">Preview a project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <Link className="app-panel-link" href="/projects">
              All projects
            </Link>
          </div>
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
      {previewProject ? (
        <ProjectSectionExplorer section={section} project={previewProject} />
      ) : (
        <p className="app-field-hint">
          Pick a project above to load its {config.label.toLowerCase()} here — you can search and
          export it without leaving this page.
        </p>
      )}
    </>
  )
}
