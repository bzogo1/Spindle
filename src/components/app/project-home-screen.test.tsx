import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProjectHome } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { ProjectHomeData } from "@/lib/api/types"

import { ProjectHomeScreen } from "./project-home-screen"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, useProjectHome: vi.fn() }
})

const homeQuery = vi.mocked(useProjectHome)

const now = "2026-11-19T12:00:00.000Z"

const owner = {
  id: "usr_01",
  email: "bogdan@example.com",
  name: "Bogdan",
  createdAt: now,
}

function buildHome(overrides: Partial<ProjectHomeData> = {}): ProjectHomeData {
  return {
    project: {
      id: "prj_01",
      name: "Coastal resilience",
      slug: "coastal-resilience",
      description: "Tidal analysis workspace",
      status: "active",
      createdAt: now,
      updatedAt: now,
      visibility: "private",
      owner,
      members: [
        { id: "mem_1", user: owner, role: "owner", joinedAt: now },
        {
          id: "mem_2",
          user: { id: "usr_02", email: "ana@example.com", name: "Ana K", createdAt: now },
          role: "member",
          joinedAt: now,
        },
      ],
    },
    files: [
      {
        id: "fil_1",
        projectId: "prj_01",
        name: "README.md",
        path: "docs/README.md",
        sizeBytes: 1024,
        createdAt: now,
      },
      {
        id: "fil_2",
        projectId: "prj_01",
        name: "schema.prisma",
        path: "prisma/schema.prisma",
        sizeBytes: 2048,
        createdAt: now,
      },
      {
        id: "fil_3",
        projectId: "prj_01",
        name: "notes.txt",
        path: "notes.txt",
        sizeBytes: 512,
        createdAt: now,
      },
    ],
    labSessions: [],
    agentRuns: [],
    chatConversationId: "conv_prj_01",
    chatMessages: [],
    activity: [
      {
        id: "evt_1",
        projectId: "prj_01",
        projectName: "Coastal resilience",
        kind: "file",
        actor: { id: "usr_01", name: "Bogdan" },
        summary: "uploaded README.md",
        target: "docs/README.md",
        createdAt: now,
      },
    ],
    storageBytes: 3584,
    generatedAt: now,
    ...overrides,
  }
}

function mockQuery(overrides: Partial<ReturnType<typeof useProjectHome>> = {}) {
  homeQuery.mockReturnValue({
    status: "success",
    mode: "ready",
    data: buildHome(),
    error: undefined,
    isRetrying: false,
    refetch: vi.fn(),
    ...overrides,
  })
}

describe("ProjectHomeScreen states", () => {
  beforeEach(() => {
    homeQuery.mockReset()
  })

  it("shows the layout skeleton while loading", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(<ProjectHomeScreen projectId="prj_01" />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading project")
    expect(screen.queryByRole("heading", { name: "Coastal resilience" })).not.toBeInTheDocument()
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
        message: "The project failed to load.",
        requestId: "req_project",
      }),
      refetch,
    })

    render(<ProjectHomeScreen projectId="prj_01" />)

    expect(screen.getByRole("alert")).toHaveTextContent("Project did not load")
    expect(screen.getByText("req_project")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("renders the overview, files preview, members, and quick links", () => {
    mockQuery()

    render(<ProjectHomeScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "Coastal resilience" })).toBeInTheDocument()
    expect(screen.getByText("Tidal analysis workspace")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()

    // Top-level folder preview deep-links into the files route.
    expect(screen.getByRole("link", { name: /^docs\// })).toHaveAttribute(
      "href",
      "/projects/prj_01/files/docs",
    )
    expect(screen.getByRole("link", { name: /^prisma\// })).toHaveAttribute(
      "href",
      "/projects/prj_01/files/prisma",
    )

    // Member stack and count.
    expect(screen.getByLabelText("2 members")).toBeInTheDocument()
    expect(screen.getByText("2 members")).toBeInTheDocument()

    // Quick links cover every project section.
    for (const label of ["Files", "Lab", "Chat", "Agent", "Activity"]) {
      expect(screen.getAllByRole("link", { name: new RegExp(label) }).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole("link", { name: /Activity/ })).toHaveAttribute(
      "href",
      "/projects/prj_01/activity",
    )

    // Recent activity feed renders.
    expect(screen.getByText(/uploaded README\.md/)).toBeInTheDocument()
  })

  it("adds an invited member through the inline form", async () => {
    mockQuery()

    render(<ProjectHomeScreen projectId="prj_01" />)

    await userEvent.click(screen.getByRole("button", { name: "Invite" }))

    const form = screen.getByRole("form", { name: "Invite member to prj_01" })
    await userEvent.type(within(form).getByLabelText("Email"), "new@example.com")
    await userEvent.selectOptions(within(form).getByLabelText("Role"), "admin")
    await userEvent.click(within(form).getByRole("button", { name: "Add member" }))

    expect(await screen.findByText("new@example.com")).toBeInTheDocument()
    expect(screen.getByText("3 members")).toBeInTheDocument()
    expect(screen.getByText("admin")).toBeInTheDocument()
  })

  it("rejects a duplicate invite email", async () => {
    mockQuery()

    render(<ProjectHomeScreen projectId="prj_01" />)

    await userEvent.click(screen.getByRole("button", { name: "Invite" }))

    const form = screen.getByRole("form", { name: "Invite member to prj_01" })
    await userEvent.type(within(form).getByLabelText("Email"), "ana@example.com")
    await userEvent.click(within(form).getByRole("button", { name: "Add member" }))

    expect(await within(form).findByRole("alert")).toHaveTextContent("already a member")
    expect(screen.getByText("2 members")).toBeInTheDocument()
  })

  it("shows empty states for files and activity when the project has none", () => {
    mockQuery({
      data: buildHome({
        files: [],
        activity: [],
      }),
    })

    render(<ProjectHomeScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "No files yet" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "No recent activity" })).toBeInTheDocument()
  })
})
