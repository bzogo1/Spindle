import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useFiles, useProjects } from "@/lib/api"
import type { Project, ProjectFile } from "@/lib/api/types"
import { useMockSession } from "@/components/app/mock-session-provider"

import { CommandMenu } from "./command-menu"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listFiles: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
  usePathname: () => "/dashboard",
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      ...actual.api,
      projects: { ...actual.api.projects, listProjects: apiMocks.listProjects },
      files: { ...actual.api.files, listFiles: apiMocks.listFiles },
    },
    useProjects: vi.fn(),
    useFiles: vi.fn(),
  }
})

vi.mock("@/components/app/mock-session-provider", () => ({
  useMockSession: vi.fn(),
}))

// These tests exercise the mock-mode workspace switcher path (local
// switchWorkspace override); real mode hits /api/workspaces instead.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...actual, mockAuthEnabled: true }
})

const projectsQuery = vi.mocked(useProjects)
const filesQuery = vi.mocked(useFiles)
const session = vi.mocked(useMockSession)

const now = "2026-11-19T12:00:00.000Z"

const projects: Project[] = [
  {
    id: "prj_01",
    name: "Tide Pool Survey",
    slug: "tide-pool-survey",
    description: "Weekly tide pool measurements",
    status: "active",
    createdAt: now,
    updatedAt: now,
  },
]

const files: ProjectFile[] = [
  {
    id: "fil_01",
    projectId: "prj_01",
    name: "measurements.csv",
    path: "data/measurements.csv",
    sizeBytes: 1024,
    mimeType: "text/csv",
    createdAt: now,
  },
]

function mockSession(overrides: Partial<ReturnType<typeof useMockSession>> = {}) {
  session.mockReturnValue({
    user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
    workspace: { name: "Tidal Lab", slug: "tidal-lab" },
    status: "authenticated",
    workspaces: [
      { name: "Tidal Lab", slug: "tidal-lab" },
      { name: "Personal workspace", slug: "personal" },
    ],
    signIn: vi.fn(),
    signOut: vi.fn(),
    switchWorkspace: vi.fn(),
    ...overrides,
  })
}

async function openMenu() {
  render(<CommandMenu />)
  await userEvent.click(screen.getByRole("button", { name: "Search" }))
  const input = await screen.findByRole("combobox", { name: "Command menu" })
  // Providers load asynchronously; wait for the first group to land.
  await screen.findByRole("group", { name: "Pages" })
  return input
}

describe("CommandMenu", () => {
  beforeEach(() => {
    navigationMocks.push.mockReset()
    projectsQuery.mockReset()
    filesQuery.mockReset()
    session.mockReset()
    apiMocks.listProjects.mockReset().mockResolvedValue(projects)
    apiMocks.listFiles.mockReset().mockResolvedValue(files)
    window.localStorage.clear()
    window.sessionStorage.clear()
    mockSession()
    projectsQuery.mockReturnValue({
      data: projects,
      error: null,
      isLoading: false,
      isRetrying: false,
      isEmpty: false,
      mode: "ready",
      status: "success",
      refetch: vi.fn(),
    })
    filesQuery.mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      isRetrying: false,
      isEmpty: true,
      mode: "ready",
      status: "success",
      refetch: vi.fn(),
    })
  })

  it("opens from the topbar button and lists pages, projects, and actions", async () => {
    await openMenu()

    expect(screen.getByRole("group", { name: "Projects" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Files" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Docs" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Changelog" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Dashboard/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /^Tide Pool Survey/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /measurements\.csv/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /New project/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Switch to Personal workspace/ })).toBeInTheDocument()
    expect(screen.getByText(/Navigate/)).toBeInTheDocument()
    expect(screen.getByText(/Select/)).toBeInTheDocument()
    expect(screen.getByText(/Close/)).toBeInTheDocument()
  })

  it("wires the combobox to the listbox for assistive tech", async () => {
    const input = await openMenu()

    expect(input).toHaveAttribute("role", "combobox")
    expect(input).toHaveAttribute("aria-autocomplete", "list")
    expect(input).toHaveAttribute("aria-expanded", "true")
    expect(input).toHaveAttribute("aria-controls", "app-command-list")
    expect(input).toHaveAttribute("aria-activedescendant", expect.any(String))
    expect(document.getElementById("app-command-list")).toHaveAttribute("role", "listbox")
  })

  it("opens with Ctrl+K", async () => {
    render(<CommandMenu />)

    await userEvent.keyboard("{Control>}k{/Control}")

    expect(await screen.findByRole("combobox", { name: "Command menu" })).toBeInTheDocument()
  })

  it("fuzzy-filters the list as the query changes", async () => {
    const input = await openMenu()

    await userEvent.type(input, "tidepool")

    // Wait for the debounced filter to actually drop non-matches.
    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /Dashboard/ })).not.toBeInTheDocument()
    })
    expect(screen.getByRole("option", { name: /^Tide Pool Survey/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Settings/ })).not.toBeInTheDocument()
  })

  it("finds docs and changelog entries through the unified index", async () => {
    const input = await openMenu()

    await userEvent.type(input, "changelog")
    await userEvent.keyboard("{Enter}")

    await waitFor(() => {
      expect(navigationMocks.push).toHaveBeenCalledWith("/changelog/1-0")
    })
  })

  it("navigates with arrow keys and Enter", async () => {
    const input = await openMenu()

    await userEvent.type(input, "automations")
    await userEvent.keyboard("{Enter}")

    expect(navigationMocks.push).toHaveBeenCalledWith("/app/automations")
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument())
  })

  it("shows recently used items when reopened with an empty query", async () => {
    const input = await openMenu()
    await userEvent.type(input, "settings")
    await userEvent.keyboard("{Enter}")

    expect(navigationMocks.push).toHaveBeenCalledWith("/app/settings")

    await userEvent.click(screen.getByRole("button", { name: "Search" }))

    const recent = await screen.findByRole("group", { name: "Recent" })
    expect(recent).toHaveTextContent("Settings")
  })

  it("runs actions without navigating", async () => {
    const signOut = vi.fn()
    mockSession({ signOut })
    const input = await openMenu()

    await userEvent.type(input, "sign out")
    await userEvent.keyboard("{Enter}")

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(navigationMocks.push).not.toHaveBeenCalled()
  })
})
