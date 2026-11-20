import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkspaceDashboard } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { ProjectSummary, WorkspaceDashboard } from "@/lib/api/types"

import { DashboardScreen } from "./dashboard-screen"
import { DASHBOARD_LAYOUT_STORAGE_KEY } from "./dashboard-layout"
import { DASHBOARD_WIDGETS_STORAGE_KEY } from "./dashboard-widgets"

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: navigationMocks.replace }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, useWorkspaceDashboard: vi.fn() }
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
  status: "active",
  createdAt: now,
  updatedAt: now,
  owner: { id: "usr_01", email: "bogdan@example.com", name: "Bogdan", createdAt: now },
  visibility: "private",
  memberCount: 2,
  fileCount: 4,
  labSessionCount: 1,
  agentRunCount: 3,
  storageBytes: 2048,
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

describe("DashboardScreen states", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    navigationMocks.replace.mockReset()
    navigationMocks.search = ""
    window.localStorage.removeItem(DASHBOARD_WIDGETS_STORAGE_KEY)
  })

  it("shows the layout skeleton while loading", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(<DashboardScreen />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard")
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument()
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
        requestId: "req_dash",
      }),
      refetch,
    })

    render(<DashboardScreen />)

    expect(screen.getByRole("alert")).toHaveTextContent("Dashboard did not load")
    expect(screen.getByText("req_dash")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state when the workspace has no projects", () => {
    mockQuery({ data: buildDashboard([]) })

    render(<DashboardScreen />)

    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument()
    expect(screen.getByText("Recent activity")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "New project" }).length).toBeGreaterThan(0)
  })

  it("renders the project list on success", () => {
    mockQuery({})

    render(<DashboardScreen />)

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Coastal resilience" })).toBeInTheDocument()
  })

  it("hides widgets disabled in the stored customization", async () => {
    window.localStorage.setItem(
      DASHBOARD_WIDGETS_STORAGE_KEY,
      JSON.stringify({
        order: ["stats", "projects", "activity", "storage", "quick-actions"],
        hidden: ["activity", "quick-actions"],
      }),
    )
    mockQuery({})

    render(<DashboardScreen />)

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Recent activity" })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole("heading", { name: "Quick actions" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Storage" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument()
  })
})

describe("ProjectSwitcher", () => {
  const secondProject: ProjectSummary = {
    ...project,
    id: "prj_02",
    name: "Tide model archive",
    slug: "tide-model-archive",
  }

  beforeEach(() => {
    dashboardQuery.mockReset()
    navigationMocks.replace.mockReset()
    navigationMocks.search = ""
    window.localStorage.removeItem(DASHBOARD_WIDGETS_STORAGE_KEY)
  })

  it("shows the current project and lists all projects in the dropdown", async () => {
    mockQuery({ data: buildDashboard([project, secondProject]) })

    render(<DashboardScreen />)

    const trigger = screen.getByRole("button", { name: /switch project/i })
    expect(trigger).toHaveTextContent("Coastal resilience")

    await userEvent.click(trigger)

    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).getByRole("option", { name: /Coastal resilience/ })).toBeInTheDocument()
    expect(within(listbox).getByRole("option", { name: /Tide model archive/ })).toBeInTheDocument()
    expect(within(listbox).getByRole("option", { name: /Create new project/ })).toBeInTheDocument()
  })

  it("filters projects by the search input and selects via the project param", async () => {
    mockQuery({ data: buildDashboard([project, secondProject]) })

    render(<DashboardScreen />)

    await userEvent.click(screen.getByRole("button", { name: /switch project/i }))
    const listbox = await screen.findByRole("listbox")
    const popover = listbox.closest('[data-slot="popover-content"]') as HTMLElement

    await userEvent.type(within(popover).getByRole("combobox"), "tide")

    expect(
      within(listbox).queryByRole("option", { name: /Coastal resilience/ }),
    ).not.toBeInTheDocument()

    await userEvent.click(within(listbox).getByRole("option", { name: /Tide model archive/ }))

    expect(navigationMocks.replace).toHaveBeenCalledWith("/dashboard?project=prj_02", {
      scroll: false,
    })
  })

  it("opens the new project dialog from the footer item", async () => {
    mockQuery({})

    render(<DashboardScreen />)

    await userEvent.click(screen.getByRole("button", { name: /switch project/i }))
    await userEvent.click(await screen.findByRole("button", { name: "Open full create form" }))

    expect(await screen.findByRole("heading", { name: "New project" })).toBeInTheDocument()
  })
})

describe("DashboardScreen shareable links", () => {
  beforeEach(() => {
    dashboardQuery.mockReset()
    navigationMocks.replace.mockReset()
    navigationMocks.search = ""
    window.localStorage.removeItem(DASHBOARD_WIDGETS_STORAGE_KEY)
    window.localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY)
  })

  it("restores widget and sort state from URL params without overwriting stored prefs", async () => {
    // Stored prefs hide "storage" and sort by name — the shared link hides
    // "activity" instead and sorts by files, and must win for this view only.
    window.localStorage.setItem(
      DASHBOARD_WIDGETS_STORAGE_KEY,
      JSON.stringify({
        order: ["stats", "projects", "activity", "storage", "quick-actions"],
        hidden: ["storage"],
      }),
    )
    window.localStorage.setItem(
      DASHBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, sort: "name" }),
    )
    navigationMocks.search = "widgets=01234-2&sort=3"
    mockQuery({})

    render(<DashboardScreen />)

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Recent activity" })).not.toBeInTheDocument()
    })
    // The shared config overrides the stored hidden list: storage stays visible.
    expect(screen.getByRole("heading", { name: "Storage" })).toBeInTheDocument()
    expect(screen.getByLabelText("Sort projects")).toHaveValue("files")

    // Stored prefs are untouched — the shared view is ephemeral.
    expect(
      JSON.parse(window.localStorage.getItem(DASHBOARD_WIDGETS_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({ hidden: ["storage"] })
    expect(
      JSON.parse(window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({ sort: "name" })
  })

  it("copies a share link encoding the current widget and sort state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    window.localStorage.setItem(
      DASHBOARD_WIDGETS_STORAGE_KEY,
      JSON.stringify({
        order: ["stats", "projects", "activity", "storage", "quick-actions"],
        hidden: ["activity"],
      }),
    )
    mockQuery({})

    render(<DashboardScreen />)

    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const href = writeText.mock.calls[0][0] as string
    const url = new URL(href)
    expect(url.pathname).toBe("/dashboard")
    // activity is widget index 2 → hidden digits "2"; default sort is omitted.
    expect(url.searchParams.get("widgets")).toBe("01234-2")
    expect(url.searchParams.get("sort")).toBeNull()
  })
})

describe("DashboardScreen onboarding banner", () => {
  const unexpectedFetch = async () => {
    throw new Error("Unexpected network request in a unit test")
  }

  beforeEach(() => {
    dashboardQuery.mockReset()
    navigationMocks.replace.mockReset()
    navigationMocks.search = ""
    window.localStorage.removeItem(DASHBOARD_WIDGETS_STORAGE_KEY)
    window.localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY)
    vi.mocked(globalThis.fetch).mockImplementation(unexpectedFetch)
  })

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockImplementation(unexpectedFetch)
  })

  it("mounts the resume banner with progress and a link to the wizard", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (!url.includes("/api/onboarding")) throw new Error(`Unexpected fetch: ${url}`)
      return new Response(
        JSON.stringify({
          ok: true,
          onboarding: {
            stepIndex: 1,
            answers: {},
            completedAt: null,
            skipped: false,
            updatedAt: "2026-11-19T12:00:00.000Z",
            startedAt: "2026-11-19T11:00:00.000Z",
            completedSteps: ["welcome"],
            stepHistory: [],
          },
          progress: { percent: 25, isComplete: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    mockQuery({})

    render(<DashboardScreen />)

    expect(await screen.findByText("Continue setup")).toBeInTheDocument()
    expect(screen.getByText(/25% complete/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Resume/ })).toHaveAttribute("href", "/app/onboarding")
  })
})
