import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkspaceDashboard } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { ProjectSummary, WorkspaceDashboard } from "@/lib/api/types"

import { ProjectSectionScreen } from "./project-section-screen"

let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/lab",
  useSearchParams: () => searchParams,
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
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
  memberCount: 1,
  fileCount: 4,
  labSessionCount: 1,
  agentRunCount: 3,
  storageBytes: 2048,
}

const secondProject: ProjectSummary = {
  ...project,
  id: "prj_02",
  name: "Tide gauge network",
  slug: "tide-gauge-network",
  description: "Buoy telemetry and storm surge modeling.",
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

describe("ProjectSectionScreen", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    searchParams = new URLSearchParams()
  })

  it("lists projects linking into the project-scoped route", () => {
    mockQuery({})

    render(<ProjectSectionScreen section="lab" />)

    const link = screen.getByRole("link", { name: /^Coastal resilience/ })
    expect(link).toHaveAttribute("href", "/projects/prj_01/lab")
    expect(screen.getByRole("heading", { name: "Choose a project" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "All projects" })).toHaveAttribute("href", "/projects")
  })

  it("offers a direct open action when the workspace has exactly one project", () => {
    mockQuery({})

    render(<ProjectSectionScreen section="lab" />)

    expect(screen.getByRole("link", { name: "Open Coastal resilience lab" })).toHaveAttribute(
      "href",
      "/projects/prj_01/lab",
    )
  })

  it("honors a valid ?project param with a direct open action", () => {
    searchParams = new URLSearchParams("project=prj_02")
    mockQuery({ data: buildDashboard([project, secondProject]) })

    render(<ProjectSectionScreen section="files" />)

    expect(screen.getByRole("link", { name: "Open Tide gauge network files" })).toHaveAttribute(
      "href",
      "/projects/prj_02/files",
    )
    expect(
      screen.queryByRole("link", { name: "Open Coastal resilience files" }),
    ).not.toBeInTheDocument()
    // The full picker list still renders underneath the shortcut.
    expect(screen.getByRole("link", { name: /^Coastal resilience/ })).toHaveAttribute(
      "href",
      "/projects/prj_01/files",
    )
  })

  it("ignores an unknown ?project param and shows the plain picker", () => {
    searchParams = new URLSearchParams("project=prj_missing")
    mockQuery({ data: buildDashboard([project, secondProject]) })

    render(<ProjectSectionScreen section="chat" />)

    expect(screen.queryByRole("link", { name: /^Open / })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /^Tide gauge network/ })).toHaveAttribute(
      "href",
      "/projects/prj_02/chat",
    )
  })

  it("routes each section to its own project screen", () => {
    mockQuery({ data: buildDashboard([project, secondProject]) })

    const { unmount } = render(<ProjectSectionScreen section="chat" />)
    expect(screen.getByRole("link", { name: /^Coastal resilience/ })).toHaveAttribute(
      "href",
      "/projects/prj_01/chat",
    )
    unmount()

    render(<ProjectSectionScreen section="files" />)
    expect(screen.getByRole("link", { name: /^Coastal resilience/ })).toHaveAttribute(
      "href",
      "/projects/prj_01/files",
    )
  })

  it("shows a loading panel while the dashboard query is pending", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(<ProjectSectionScreen section="files" />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading files")
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
        message: "The dashboard failed to load.",
        requestId: "req_dashboard",
      }),
      refetch,
    })

    render(<ProjectSectionScreen section="chat" />)

    expect(screen.getByRole("alert")).toHaveTextContent("Projects did not load")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("shows an intentional empty state linking to projects when none exist", () => {
    mockQuery({ data: buildDashboard([]) })

    render(<ProjectSectionScreen section="lab" />)

    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to projects" })).toHaveAttribute(
      "href",
      "/projects",
    )
    expect(screen.queryByRole("link", { name: /Coastal resilience/ })).not.toBeInTheDocument()
  })
})
