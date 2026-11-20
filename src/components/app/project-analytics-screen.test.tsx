import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProjectHome } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { ActivityEvent, ProjectHomeData } from "@/lib/api/types"

import {
  ProjectAnalyticsScreen,
  activityByKind,
  dailyActivitySeries,
} from "./project-analytics-screen"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, useProjectHome: vi.fn() }
})

const homeQuery = vi.mocked(useProjectHome)

const now = new Date().toISOString()

const owner = {
  id: "usr_01",
  email: "bogdan@example.com",
  name: "Bogdan",
  createdAt: now,
}

function buildEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "evt_1",
    projectId: "prj_01",
    projectName: "Coastal resilience",
    kind: "file",
    actor: { id: "usr_01", name: "Bogdan" },
    summary: "uploaded README.md",
    target: "docs/README.md",
    createdAt: now,
    ...overrides,
  }
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
      members: [{ id: "mem_1", user: owner, role: "owner", joinedAt: now }],
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
    ],
    labSessions: [
      { id: "lab_1", projectId: "prj_01", title: "Tide model", status: "running", createdAt: now },
    ],
    agentRuns: [
      {
        id: "run_1",
        projectId: "prj_01",
        prompt: "summarize files",
        status: "succeeded",
        createdAt: now,
      },
    ],
    chatConversationId: "conv_prj_01",
    chatMessages: [
      {
        id: "msg_1",
        conversationId: "conv_prj_01",
        projectId: "prj_01",
        role: "user",
        content: "hello",
        createdAt: now,
      },
    ],
    activity: [buildEvent()],
    storageBytes: 1024,
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

describe("activityByKind", () => {
  it("counts events per kind in ACTIVITY_KINDS order, keeping zero-count kinds", () => {
    const entries = activityByKind([
      buildEvent({ id: "e1", kind: "file" }),
      buildEvent({ id: "e2", kind: "file" }),
      buildEvent({ id: "e3", kind: "agent" }),
    ])

    expect(entries.map((entry) => entry.kind)).toEqual([
      "project",
      "file",
      "lab",
      "chat",
      "agent",
      "system",
    ])
    expect(entries.find((entry) => entry.kind === "file")?.count).toBe(2)
    expect(entries.find((entry) => entry.kind === "agent")?.count).toBe(1)
    expect(entries.find((entry) => entry.kind === "chat")?.count).toBe(0)
    expect(entries.find((entry) => entry.kind === "file")?.label).toBe("File")
  })
})

describe("dailyActivitySeries", () => {
  it("returns a full window of days ending today, oldest first", () => {
    const points = dailyActivitySeries([buildEvent()], 3)

    expect(points).toHaveLength(3)
    const today = new Date()
    const pad = (value: number) => String(value).padStart(2, "0")
    const expectedToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(
      today.getDate(),
    )}`
    expect(points[2].date).toBe(expectedToday)
    expect(points[2].events).toBe(1)
    expect(points[0].events + points[1].events + points[2].events).toBe(1)
  })

  it("ignores events outside the window and unparseable timestamps", () => {
    const old = new Date()
    old.setDate(old.getDate() - 30)
    const points = dailyActivitySeries(
      [
        buildEvent({ id: "old", createdAt: old.toISOString() }),
        buildEvent({ id: "bad", createdAt: "nope" }),
      ],
      7,
    )

    expect(points).toHaveLength(7)
    expect(points.reduce((sum, point) => sum + point.events, 0)).toBe(0)
  })
})

describe("ProjectAnalyticsScreen", () => {
  beforeEach(() => {
    homeQuery.mockReset()
  })

  it("shows the loading panel while the project query is pending", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(<ProjectAnalyticsScreen projectId="prj_01" />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading project")
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

    render(<ProjectAnalyticsScreen projectId="prj_01" />)

    expect(screen.getByRole("alert")).toHaveTextContent("Project did not load")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("renders stat cards and activity charts", () => {
    mockQuery()

    render(<ProjectAnalyticsScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument()
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(breadcrumb).toHaveTextContent("Coastal resilience")

    const totals = screen.getByRole("region", { name: "Project totals" })
    expect(totals).toHaveTextContent("Files")
    expect(totals).toHaveTextContent("Lab sessions")
    expect(totals).toHaveTextContent("Agent runs")
    expect(totals).toHaveTextContent("Chat messages")
    expect(totals).toHaveTextContent("Activity events")
    expect(totals).toHaveTextContent("Storage")
    expect(totals).toHaveTextContent("1 KB")

    expect(screen.getByRole("heading", { name: "Activity by type" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Daily activity" })).toBeInTheDocument()
  })

  it("shows the empty activity state when the project has no events", () => {
    mockQuery({ data: buildHome({ activity: [] }) })

    render(<ProjectAnalyticsScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "No activity yet" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open files" })).toHaveAttribute(
      "href",
      "/projects/prj_01/files",
    )
    expect(screen.queryByRole("heading", { name: "Activity by type" })).not.toBeInTheDocument()
  })
})
