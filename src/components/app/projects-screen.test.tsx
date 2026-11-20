import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkspaceDashboard } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { Project, ProjectSummary, WorkspaceDashboard } from "@/lib/api/types"
import { Toaster } from "@/components/ui/toast"

import { ProjectsScreen } from "./projects-screen"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

const createProjectMock = vi.hoisted(() => vi.fn())
const updateProjectMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push, replace: vi.fn() }),
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      ...actual.api,
      projects: {
        ...actual.api.projects,
        createProject: createProjectMock,
        updateProject: updateProjectMock,
      },
    },
    useWorkspaceDashboard: vi.fn(),
  }
})

const dashboardQuery = vi.mocked(useWorkspaceDashboard)

const now = "2026-11-19T12:00:00.000Z"

function buildDashboard(projects: ProjectSummary[] = []): WorkspaceDashboard {
  return {
    workspace: {
      id: "wsp_01",
      name: "Tidal Lab",
      slug: "tidal-lab",
      role: "owner",
      createdAt: now,
    },
    user: { id: "usr_01", email: "bogdan@example.com", name: "Bogdan", createdAt: now },
    projects,
    activity: [],
    storage: {
      usedBytes: 1024,
      totalBytes: 4096,
      fileBytes: 512,
      computeBytes: 512,
      availableBytes: 3072,
    },
    generatedAt: now,
  }
}

const member = { id: "usr_02", email: "mara@example.com", name: "Mara", createdAt: now }
const otherOwner = { id: "usr_03", email: "ines@example.com", name: "Ines", createdAt: now }

const project: ProjectSummary = {
  id: "prj_01",
  name: "Coastal resilience",
  slug: "coastal-resilience",
  description: "Field study and survey data.",
  status: "active",
  createdAt: now,
  updatedAt: now,
  owner: { id: "usr_01", email: "bogdan@example.com", name: "Bogdan", createdAt: now },
  visibility: "private",
  memberCount: 2,
  members: [member, { id: "usr_01", email: "bogdan@example.com", name: "Bogdan", createdAt: now }],
  fileCount: 4,
  labSessionCount: 1,
  agentRunCount: 3,
  storageBytes: 2048,
}

const archivedProject: ProjectSummary = {
  ...project,
  id: "prj_02",
  name: "Archive shelf",
  slug: "archive-shelf",
  description: "Retired experiments.",
  status: "archived",
  owner: otherOwner,
}

function mockQuery(overrides: Partial<ReturnType<typeof useWorkspaceDashboard>>) {
  dashboardQuery.mockReturnValue({
    status: "success",
    mode: "ready",
    data: buildDashboard([project]),
    error: undefined,
    isRetrying: false,
    refetch: vi.fn(),
    ...overrides,
  })
}

describe("ProjectsScreen states", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    createProjectMock.mockReset()
    navigationMocks.push.mockReset()
    window.localStorage.clear()
  })

  it("shows the layout skeleton while loading", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(<ProjectsScreen />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading projects")
    expect(screen.queryByRole("heading", { name: "Projects" })).not.toBeInTheDocument()
  })

  it("shows the error state and retries through refetch", async () => {
    const refetch = vi.fn()
    mockQuery({
      status: "error",
      mode: "error",
      data: undefined,
      error: new ApiError({
        status: 503,
        code: "mock_error",
        message: "The projects failed to load.",
        requestId: "req_projects",
      }),
      refetch,
    })

    render(<ProjectsScreen />)

    expect(screen.getByRole("alert")).toHaveTextContent("Projects did not load")
    expect(screen.getByText("req_projects")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state when the workspace has no projects", () => {
    mockQuery({ data: buildDashboard([]) })

    render(<ProjectsScreen />)

    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "New project" }).length).toBeGreaterThan(0)
  })

  it("renders project cards with member avatars and links to the detail route", () => {
    mockQuery({})

    render(<ProjectsScreen />)

    const card = screen.getByRole("link", { name: /Coastal resilience/ })
    expect(card).toHaveAttribute("href", "/projects/prj_01")
    expect(screen.getByText("Field study and survey data.")).toBeInTheDocument()
    expect(screen.getByTitle("Mara")).toBeInTheDocument()
  })

  it("opens the create-project dialog from the new project card", async () => {
    mockQuery({})

    render(<ProjectsScreen />)

    const triggers = screen.getAllByRole("button", { name: /New project/ })
    await userEvent.click(triggers[triggers.length - 1])

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/Step 1 of 3/)).toBeInTheDocument()
    expect(within(dialog).getByRole("radio", { name: /Blank project/ })).toBeInTheDocument()
  })
})

describe("ProjectsScreen filters and view", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    window.localStorage.clear()
  })

  it("filters projects by status", async () => {
    mockQuery({ data: buildDashboard([project, archivedProject]) })

    render(<ProjectsScreen />)

    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "archived")

    expect(screen.getByRole("link", { name: /Archive shelf/ })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Coastal resilience/ })).not.toBeInTheDocument()
  })

  it("filters projects by owner", async () => {
    mockQuery({ data: buildDashboard([project, archivedProject]) })

    render(<ProjectsScreen />)

    await userEvent.selectOptions(screen.getByLabelText("Filter by owner"), "usr_03")

    expect(screen.getByRole("link", { name: /Archive shelf/ })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Coastal resilience/ })).not.toBeInTheDocument()
  })

  it("filters projects by search text", async () => {
    mockQuery({ data: buildDashboard([project, archivedProject]) })

    render(<ProjectsScreen />)

    await userEvent.type(screen.getByLabelText("Search projects"), "survey")

    expect(screen.getByRole("link", { name: /Coastal resilience/ })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Archive shelf/ })).not.toBeInTheDocument()
  })

  it("shows the no-matches state and clears filters", async () => {
    mockQuery({})

    render(<ProjectsScreen />)

    await userEvent.type(screen.getByLabelText("Search projects"), "zzz")

    expect(screen.getByRole("heading", { name: "No matching projects" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(screen.getByRole("link", { name: /Coastal resilience/ })).toBeInTheDocument()
  })

  it("sorts projects with the selected option", async () => {
    mockQuery({
      data: buildDashboard([
        { ...archivedProject, fileCount: 99, updatedAt: "2026-01-01T00:00:00.000Z" },
        { ...project, updatedAt: "2026-11-19T12:00:00.000Z" },
      ]),
    })

    render(<ProjectsScreen />)

    const projectLinks = () =>
      screen
        .getAllByRole("link")
        .filter((link) => /Archive shelf|Coastal resilience/.test(link.textContent ?? ""))

    // Default "Recently active" puts the more recently updated project first.
    expect(projectLinks()[0]).toHaveTextContent("Coastal resilience")

    await userEvent.selectOptions(screen.getByLabelText("Sort projects"), "files")
    expect(projectLinks()[0]).toHaveTextContent("Archive shelf")

    await userEvent.selectOptions(screen.getByLabelText("Sort projects"), "name")
    expect(projectLinks()[0]).toHaveTextContent("Archive shelf")
  })

  it("switches to list view and persists the preference", async () => {
    mockQuery({})

    render(<ProjectsScreen />)

    expect(document.querySelector(".app-project-grid")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "List view" }))

    expect(document.querySelector(".app-project-list")).toBeInTheDocument()
    expect(window.localStorage.getItem("spindle.projects.view")).toBe("list")

    const row = screen.getByRole("link", { name: /Coastal resilience/ })
    expect(row).toHaveAttribute("href", "/projects/prj_01")
    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      "/projects/prj_01/files",
    )

    await userEvent.click(screen.getByRole("button", { name: "Grid view" }))
    expect(window.localStorage.getItem("spindle.projects.view")).toBe("grid")
  })
})

describe("ProjectsScreen create project", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    createProjectMock.mockReset()
    navigationMocks.push.mockReset()
  })

  it("creates a project, toasts, and navigates to it", async () => {
    mockQuery({})
    const created: Project = {
      id: "prj_new",
      name: "Tide pools",
      slug: "tide-pools",
      description: "Seasonal survey.",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }
    createProjectMock.mockResolvedValue(created)

    render(
      <>
        <ProjectsScreen />
        <Toaster />
      </>,
    )

    await userEvent.click(screen.getAllByRole("button", { name: "New project" })[0])

    const dialog = screen.getByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }))
    await userEvent.type(within(dialog).getByLabelText("Name"), "Tide pools")
    await userEvent.type(within(dialog).getByLabelText("Description"), "Seasonal survey.")
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }))
    await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }))

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Tide pools",
        description: "Seasonal survey.",
        templateId: "blank",
      })
    })
    await waitFor(() => {
      expect(navigationMocks.push).toHaveBeenCalledWith("/projects/prj_new")
    })
    expect(await screen.findByText("Project created")).toBeInTheDocument()
  })

  it("shows an error toast when creation fails", async () => {
    mockQuery({})
    createProjectMock.mockRejectedValue(
      new ApiError({
        status: 500,
        code: "create_failed",
        message: "The project could not be saved.",
        requestId: "req_create",
      }),
    )

    render(
      <>
        <ProjectsScreen />
        <Toaster />
      </>,
    )

    await userEvent.click(screen.getAllByRole("button", { name: "New project" })[0])

    const dialog = screen.getByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }))
    await userEvent.type(within(dialog).getByLabelText("Name"), "Broken project")
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }))
    await userEvent.click(within(dialog).getByRole("button", { name: "Create project" }))

    expect(await screen.findByText("Couldn't create project")).toBeInTheDocument()
    expect(navigationMocks.push).not.toHaveBeenCalled()
  })
})

describe("ProjectsScreen clone project", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    createProjectMock.mockReset()
    navigationMocks.push.mockReset()
  })

  it("clones a project from the card action, toasts, and navigates to the copy", async () => {
    mockQuery({})
    const created: Project = {
      id: "prj_copy",
      name: "Coastal resilience (copy)",
      slug: "coastal-resilience-copy",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }
    createProjectMock.mockResolvedValue(created)

    render(
      <>
        <ProjectsScreen />
        <Toaster />
      </>,
    )

    await userEvent.click(screen.getByRole("button", { name: "Clone" }))

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith({
        name: "Coastal resilience (copy)",
        description: "Field study and survey data.",
        templateId: undefined,
        cloneFromProjectId: "prj_01",
      })
    })
    await waitFor(() => {
      expect(navigationMocks.push).toHaveBeenCalledWith("/projects/prj_copy")
    })
    expect(await screen.findByText("Project cloned")).toBeInTheDocument()
  })

  it("shows an error toast when cloning fails", async () => {
    mockQuery({})
    createProjectMock.mockRejectedValue(
      new ApiError({
        status: 500,
        code: "clone_failed",
        message: "The project could not be copied.",
        requestId: "req_clone",
      }),
    )

    render(
      <>
        <ProjectsScreen />
        <Toaster />
      </>,
    )

    await userEvent.click(screen.getByRole("button", { name: "Clone" }))

    expect(await screen.findByText("Couldn't clone project")).toBeInTheDocument()
    expect(navigationMocks.push).not.toHaveBeenCalled()
  })
})

describe("ProjectsScreen archive project", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    updateProjectMock.mockReset()
  })

  it("archives a project from the card action, toasts, and refetches", async () => {
    const refetch = vi.fn()
    mockQuery({ refetch })
    updateProjectMock.mockResolvedValue({
      ...project,
      status: "archived",
    })

    render(
      <>
        <ProjectsScreen />
        <Toaster />
      </>,
    )

    await userEvent.click(screen.getByRole("button", { name: "Archive" }))

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith("prj_01", { status: "archived" })
    })
    expect(await screen.findByText("Project archived")).toBeInTheDocument()
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
