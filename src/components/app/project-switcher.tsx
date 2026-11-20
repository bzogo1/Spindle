"use client"

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getAvatarInitials } from "@/components/ui/avatar"
import { InlineError } from "@/components/app/states/inline-error"
import { useToast } from "@/components/ui/toast"
import { api, useMutation } from "@/lib/api"
import type { CreateProjectInput, ProjectSummary } from "@/lib/api/types"

function initials(name: string) {
  return getAvatarInitials(name)
}

/**
 * Subsequence fuzzy match, same scoring approach as the command menu: lower
 * scores are better, `null` means no match.
 */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0

  const substring = t.indexOf(q)
  if (substring !== -1) {
    const boundary = substring === 0 || /[\s\-_./]/.test(t[substring - 1]) ? 0 : 50
    return substring * 10 + boundary
  }

  let qi = 0
  let score = 0
  let lastMatch = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] !== q[qi]) continue
    const gap = lastMatch === -1 ? ti : ti - lastMatch - 1
    score += gap * 3 + ti * 0.1
    if (ti === 0 || /[\s\-_./]/.test(t[ti - 1])) score -= 8
    lastMatch = ti
    qi += 1
  }
  return qi === q.length ? 1000 + score : null
}

function projectScore(project: ProjectSummary, query: string): number | null {
  const candidates = [
    fuzzyScore(query, project.name),
    fuzzyScore(query, project.slug),
    project.description ? fuzzyScore(query, project.description) : null,
  ].filter((score): score is number => score !== null)
  return candidates.length > 0 ? Math.min(...candidates) : null
}

type SwitcherItem =
  { kind: "project"; id: string; project: ProjectSummary } | { kind: "create"; id: string }

const CREATE_ITEM_ID = "action:create-project"

/**
 * Project switcher for the dashboard header. Selection lives in the `project`
 * search param; the list comes from the workspace dashboard query. The popover
 * mirrors the command menu: fuzzy search, arrow-key navigation, and an inline
 * quick-create row that hits the same `api.projects.createProject` mutation as
 * the dashboard's new-project dialog.
 */
export function ProjectSwitcher({
  projects,
  onCreateProject,
}: {
  projects: ProjectSummary[]
  onCreateProject: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const createProject = useMutation((input: CreateProjectInput) =>
    api.projects.createProject(input),
  )

  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (itemId: string) => `${baseId}-option-${itemId}`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => {
    const requested = searchParams.get("project")
    return projects.find((project) => project.id === requested) ?? projects[0]
  }, [projects, searchParams])

  const filtered = useMemo(() => {
    const normalized = query.trim()
    if (!normalized) return projects
    return projects
      .map((project) => ({ project, score: projectScore(project, normalized) }))
      .filter((entry): entry is { project: ProjectSummary; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.project.name.localeCompare(b.project.name))
      .map((entry) => entry.project)
  }, [projects, query])

  const flatItems = useMemo<SwitcherItem[]>(
    () => [
      ...filtered.map((project): SwitcherItem => ({
        kind: "project",
        id: `project:${project.id}`,
        project,
      })),
      { kind: "create", id: CREATE_ITEM_ID },
    ],
    [filtered],
  )

  useEffect(() => {
    setActiveId((current) =>
      current && flatItems.some((item) => item.id === current)
        ? current
        : (flatItems[0]?.id ?? null),
    )
  }, [flatItems])

  useEffect(() => {
    if (!activeId || !listRef.current) return
    const element = listRef.current.querySelector(`[data-switcher-id="${CSS.escape(activeId)}"]`)
    element?.scrollIntoView?.({ block: "nearest" })
  }, [activeId])

  useEffect(() => {
    if (creating) createInputRef.current?.focus()
  }, [creating])

  function selectProject(project: ProjectSummary) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("project", project.id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function moveActive(direction: 1 | -1) {
    if (flatItems.length === 0) return
    const index = flatItems.findIndex((item) => item.id === activeId)
    const nextIndex =
      index === -1
        ? direction === 1
          ? 0
          : flatItems.length - 1
        : (index + direction + flatItems.length) % flatItems.length
    setActiveId(flatItems[nextIndex]?.id ?? null)
  }

  function activate(id: string | null) {
    const item = flatItems.find((entry) => entry.id === id) ?? flatItems[0]
    if (!item) return
    if (item.kind === "project") {
      selectProject(item.project)
      handleOpenChange(false)
    } else {
      setCreating(true)
      setCreateName(query.trim())
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = createName.trim()
    if (!name || createProject.isLoading) return
    try {
      await createProject.mutate({ name })
      toast({
        title: "Project created",
        description: `“${name}” is ready to use.`,
        variant: "success",
      })
      resetMenuState()
      setOpen(false)
    } catch (error) {
      toast({
        title: "Couldn't create project",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "error",
      })
    }
  }

  function resetMenuState() {
    setQuery("")
    setActiveId(null)
    setCreating(false)
    setCreateName("")
    createProject.reset()
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) resetMenuState()
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      activate(activeId)
    }
  }

  function onCreateKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setCreating(false)
      setCreateName("")
    }
  }

  function renderItem(item: SwitcherItem) {
    const active = item.id === activeId
    const selectedProject = item.kind === "project" && item.project.id === selected?.id
    return (
      <div
        key={item.id}
        id={optionId(item.id)}
        role="option"
        aria-selected={active}
        data-switcher-id={item.id}
        className={`app-command-item${active ? "is-active" : ""}`}
        onMouseMove={() => setActiveId(item.id)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => activate(item.id)}
      >
        {item.kind === "project" ? (
          <>
            <span className="app-project-avatar app-project-avatar--sm" aria-hidden="true">
              {initials(item.project.name)}
            </span>
            <span className="app-command-item-text">
              <span className="app-command-item-label">{item.project.name}</span>
              {item.project.description ? (
                <span className="app-command-item-hint">{item.project.description}</span>
              ) : null}
            </span>
            {selectedProject ? <Check className="app-menu-check" aria-hidden="true" /> : null}
          </>
        ) : (
          <>
            <span className="app-command-item-icon" aria-hidden="true">
              <Plus />
            </span>
            <span className="app-command-item-text">
              <span className="app-command-item-label">
                {query.trim() ? `Create “${query.trim()}”` : "Create new project"}
              </span>
              <span className="app-command-item-hint">Quick create</span>
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className="app-project-switcher-trigger"
        aria-label={`Switch project — ${selected?.name ?? "Select project"}`}
      >
        {/* Initial rendered via CSS `content` (see .app-avatar[data-initial])
            so axe's label-content-name-mismatch doesn't count it as visible
            text the accessible name must repeat. */}
        <span
          className="app-project-avatar"
          aria-hidden="true"
          data-initial={initials(selected?.name ?? "?")}
        />
        <span className="app-project-switcher-name">{selected?.name ?? "Select project"}</span>
        <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        size="auto"
        className="app-menu app-project-switcher-menu"
        aria-label="Switch project"
      >
        <div className="app-project-switcher-search">
          <Search aria-hidden="true" />
          <Input
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeId ? optionId(activeId) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search projects"
            aria-label="Search projects"
            className="app-command-input-field"
          />
        </div>
        {creating ? (
          <form className="app-project-switcher-create" onSubmit={submitCreate}>
            <Plus aria-hidden="true" />
            <Input
              ref={createInputRef}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={onCreateKeyDown}
              placeholder="Project name"
              aria-label="New project name"
              maxLength={80}
              required
            />
            <Button
              type="submit"
              size="sm"
              disabled={createProject.isLoading || !createName.trim()}
            >
              {createProject.isLoading ? "Creating…" : "Create"}
            </Button>
          </form>
        ) : (
          <>
            <div
              className="app-command-list app-project-switcher-list"
              role="listbox"
              id={listId}
              ref={listRef}
            >
              {filtered.length === 0 ? (
                <p className="app-command-empty">
                  No projects match “{query.trim()}” — create one below.
                </p>
              ) : (
                filtered.map((project) =>
                  renderItem({ kind: "project", id: `project:${project.id}`, project }),
                )
              )}
              {renderItem({ kind: "create", id: CREATE_ITEM_ID })}
            </div>
            <div className="app-project-switcher-create-footer">
              <button
                type="button"
                className="app-project-switcher-more"
                onClick={() => {
                  handleOpenChange(false)
                  onCreateProject()
                }}
              >
                Open full create form
              </button>
            </div>
          </>
        )}
        {createProject.error ? (
          <InlineError
            title="Could not create project"
            message={createProject.error.message}
            error={createProject.error}
            className="app-project-switcher-error"
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
