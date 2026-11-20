import type { ReactNode } from "react"
import { BookOpen, FileText, FolderKanban, History } from "lucide-react"

import { api } from "@/lib/api"
import {
  changelogReleases,
  formatReleaseDate,
  getReleaseAnchor,
  getReleasePath,
} from "@/lib/changelog"
import { DOCS_SEARCH_INDEX } from "@/lib/docs-search"

import type { SearchIndexProvider } from "./index"

/**
 * Domain providers for the command-menu search index. Each factory returns a
 * `SearchIndexProvider`; the index loads them lazily and caches the results.
 * Navigation targets use `href`; non-navigation commands use `action` + `meta`.
 */

export type PageEntry = {
  label: string
  href: string
  keywords?: string
  icon?: ReactNode
  /** Section facet for the page (e.g. "Marketing", "App"). Defaults to "Pages". */
  section?: string
  /** Extra facet tags. */
  tags?: string[]
}

export function createPagesProvider(pages: PageEntry[]): SearchIndexProvider {
  return {
    id: "pages",
    group: "Pages",
    load: () =>
      pages.map((page) => ({
        id: `page:${page.href}`,
        title: page.label,
        subtitle: "Page",
        keywords: page.keywords ?? page.href,
        group: "Pages",
        type: "page",
        section: page.section ?? "Pages",
        tags: page.tags,
        icon: page.icon,
        href: page.href,
      })),
  }
}

export function createProjectsProvider(): SearchIndexProvider {
  return {
    id: "projects",
    group: "Projects",
    load: async () => {
      const projects = await api.projects.listProjects()
      return projects.map((project) => ({
        id: `project:${project.id}`,
        title: project.name,
        subtitle: project.description || "Project",
        keywords: `${project.slug} ${project.description ?? ""}`,
        group: "Projects",
        type: "project",
        section: "Projects",
        icon: <FolderKanban aria-hidden="true" />,
        href: `/projects/${project.id}`,
      }))
    },
  }
}

/** Folder segments of a project file path, e.g. "docs/guide/a.md" → "docs/guide". */
function fileFolderPath(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean)
  segments.pop() // drop the file name
  return segments.join("/")
}

function fileHref(projectId: string, filePath: string): string {
  const folder = fileFolderPath(filePath)
  const base = `/projects/${projectId}/files`
  return folder ? `${base}/${folder.split("/").map(encodeURIComponent).join("/")}` : base
}

export function createFilesProvider(): SearchIndexProvider {
  return {
    id: "files",
    group: "Files",
    load: async () => {
      const [files, projects] = await Promise.all([
        api.files.listFiles(),
        api.projects.listProjects(),
      ])
      const projectNames = new Map(projects.map((project) => [project.id, project.name]))
      return files.map((file) => {
        const folder = fileFolderPath(file.path)
        const projectName = projectNames.get(file.projectId)
        return {
          id: `file:${file.id}`,
          title: file.name,
          subtitle: [projectName, folder || "Project root"].filter(Boolean).join(" · "),
          keywords: `${file.path} ${file.name} ${file.mimeType ?? ""}`,
          group: "Files",
          type: "file",
          section: folder || "Project root",
          icon: <FileText aria-hidden="true" />,
          href: fileHref(file.projectId, file.path),
        }
      })
    },
  }
}

/** Cap on body text folded into keywords — enough for matching, cheap to scan. */
const DOCS_KEYWORD_LIMIT = 800

export function createDocsProvider(): SearchIndexProvider {
  return {
    id: "docs",
    group: "Docs",
    load: () =>
      DOCS_SEARCH_INDEX.map((entry) => {
        const isSection = entry.sectionId !== entry.guideId
        return {
          id: `doc:${entry.guideId}:${entry.sectionId}`,
          title: isSection ? entry.sectionTitle : entry.guideTitle,
          subtitle: isSection ? `Docs · ${entry.guideTitle}` : "Docs",
          keywords: `${entry.guideTitle} ${entry.sectionTitle} ${entry.text.slice(0, DOCS_KEYWORD_LIMIT)}`,
          group: "Docs",
          type: "doc",
          section: entry.guideTitle,
          tags: [entry.guideTitle],
          icon: <BookOpen aria-hidden="true" />,
          href: entry.href,
        }
      }),
  }
}

export function createChangelogProvider(): SearchIndexProvider {
  return {
    id: "changelog",
    group: "Changelog",
    load: () =>
      changelogReleases.map((release) => ({
        id: `changelog:${release.slug}`,
        title: release.title,
        subtitle: `Changelog · v${release.version} · ${formatReleaseDate(release.date)}`,
        keywords: `${release.version} ${release.tags.join(" ")} ${release.summary}`,
        group: "Changelog",
        type: "changelog",
        section: "Changelog",
        tags: release.tags,
        updatedAt: release.date,
        icon: <History aria-hidden="true" />,
        href: getReleasePath(release) || `/changelog#${getReleaseAnchor(release)}`,
      })),
  }
}

export type SearchActionSpec = {
  id: string
  title: string
  subtitle?: string
  keywords?: string
  group?: string
  icon?: ReactNode
  /** Named action the UI dispatches (e.g. "new-project", "toggle-theme"). */
  action: string
  /** Navigation target; when set it wins over `action`. */
  href?: string
  meta?: Record<string, string>
}

/**
 * Provider for non-navigation commands. The cacheKey embeds the action ids so
 * the provider reloads when the available actions change (e.g. workspace list).
 */
export function createActionsProvider(actions: SearchActionSpec[]): SearchIndexProvider {
  return {
    id: "actions",
    group: "Actions",
    cacheKey: actions.map((action) => `${action.id}:${action.title}`).join("|"),
    load: () =>
      actions.map((action) => ({
        id: action.id,
        title: action.title,
        subtitle: action.subtitle,
        keywords: action.keywords,
        group: action.group ?? "Actions",
        type: "action",
        section: action.group ?? "Actions",
        icon: action.icon,
        action: action.action,
        href: action.href,
        meta: action.meta,
      })),
  }
}
