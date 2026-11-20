import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProjectHome } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { ActivityEvent, ProjectHomeData } from "@/lib/api/types"

import {
  ProjectActivityScreen,
  activityExportCsv,
  activityExportJson,
} from "./project-activity-screen"

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
    files: [],
    labSessions: [],
    agentRuns: [],
    chatConversationId: "conv_prj_01",
    chatMessages: [],
    activity: [buildEvent()],
    storageBytes: 0,
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

describe("activityExportCsv", () => {
  it("writes one row per event with timestamp, kind, actor, summary, and target", () => {
    const csv = activityExportCsv([
      buildEvent(),
      buildEvent({
        id: "evt_2",
        kind: "agent",
        summary: 'started "run"',
        target: undefined,
        createdAt: "2026-11-02T00:00:00.000Z",
      }),
    ])

    expect(csv).toContain('"timestamp","kind","actor","summary","target"')
    expect(csv).toContain(`"${now}","file","Bogdan","uploaded README.md","docs/README.md"`)
    expect(csv).toContain('"2026-11-02T00:00:00.000Z","agent","Bogdan","started ""run""",""')
  })
})

describe("activityExportJson", () => {
  it("serializes the exported fields per event", () => {
    expect(JSON.parse(activityExportJson([buildEvent()]))).toEqual([
      {
        timestamp: now,
        kind: "file",
        actor: "Bogdan",
        summary: "uploaded README.md",
        target: "docs/README.md",
      },
    ])
  })
})

describe("ProjectActivityScreen", () => {
  beforeEach(() => {
    homeQuery.mockReset()
  })

  it("shows the loading panel while the project query is pending", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(<ProjectActivityScreen projectId="prj_01" />)

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

    render(<ProjectActivityScreen projectId="prj_01" />)

    expect(screen.getByRole("alert")).toHaveTextContent("Project did not load")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("renders the activity feed with the project breadcrumb and count", () => {
    mockQuery({
      data: buildHome({
        activity: [
          buildEvent({ id: "evt_1" }),
          buildEvent({
            id: "evt_2",
            kind: "agent",
            summary: "started a run",
            target: undefined,
          }),
        ],
      }),
    })

    render(<ProjectActivityScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument()
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(breadcrumb).getByRole("link", { name: "Coastal resilience" })).toHaveAttribute(
      "href",
      "/projects/prj_01",
    )
    expect(screen.getByText("2 events")).toBeInTheDocument()
    expect(screen.getByText(/uploaded README\.md/)).toBeInTheDocument()
    expect(screen.getByText(/started a run/)).toBeInTheDocument()
  })

  it("filters the feed by activity type", async () => {
    mockQuery({
      data: buildHome({
        activity: [
          buildEvent({ id: "evt_1", kind: "file", summary: "uploaded README.md" }),
          buildEvent({
            id: "evt_2",
            kind: "agent",
            summary: "started a run",
            target: undefined,
          }),
        ],
      }),
    })

    render(<ProjectActivityScreen projectId="prj_01" />)

    expect(screen.getByText("2 events")).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText("Filter by type"), "agent")

    expect(screen.queryByText(/uploaded README\.md/)).not.toBeInTheDocument()
    expect(screen.getByText(/started a run/)).toBeInTheDocument()
    expect(screen.getByText(/1 event of 2/)).toBeInTheDocument()
  })

  it("offers to clear the type filter when nothing matches", async () => {
    mockQuery({ data: buildHome({ activity: [buildEvent({ kind: "file" })] }) })

    render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.selectOptions(screen.getByLabelText("Filter by type"), "chat")

    expect(screen.getByRole("heading", { name: "No chat activity" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Show all activity" }))

    expect(screen.getByText(/uploaded README\.md/)).toBeInTheDocument()
    expect(screen.getByText("1 event")).toBeInTheDocument()
  })

  it("uses the singular label for a single event", () => {
    mockQuery({ data: buildHome({ activity: [buildEvent()] }) })

    render(<ProjectActivityScreen projectId="prj_01" />)

    expect(screen.getByText("1 event")).toBeInTheDocument()
  })

  it("exports the filtered activity feed as CSV", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    mockQuery({
      data: buildHome({
        activity: [
          buildEvent({ id: "evt_1", kind: "file", summary: "uploaded README.md" }),
          buildEvent({ id: "evt_2", kind: "agent", summary: "started a run" }),
        ],
      }),
    })

    render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.selectOptions(screen.getByLabelText("Filter by type"), "agent")
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    const csv = await blob.text()
    expect(csv).toContain('"agent","Bogdan","started a run"')
    expect(csv).not.toContain("uploaded README.md")
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("exports the activity feed as JSON", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    mockQuery({ data: buildHome() })

    render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]
    expect(blob.type).toBe("application/json")
    expect(JSON.parse(await blob.text())).toEqual([
      {
        timestamp: now,
        kind: "file",
        actor: "Bogdan",
        summary: "uploaded README.md",
        target: "docs/README.md",
      },
    ])
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("filters the feed by search text across actor, summary, and target", async () => {
    mockQuery({
      data: buildHome({
        activity: [
          buildEvent({ id: "evt_1", summary: "uploaded README.md", target: "docs/README.md" }),
          buildEvent({
            id: "evt_2",
            kind: "agent",
            actor: { id: "usr_02", name: "Readme Bot" },
            summary: "started a run",
            target: undefined,
          }),
          buildEvent({
            id: "evt_3",
            kind: "chat",
            summary: "posted a message",
            target: undefined,
          }),
        ],
      }),
    })

    render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.type(screen.getByLabelText("Search activity"), "readme")

    // Highlighted matches split the text, so assert on the list items' content.
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("uploaded README.md")
    expect(items[0]).toHaveTextContent("docs/README.md")
    expect(items[1]).toHaveTextContent("Readme Bot")
    expect(items[1]).toHaveTextContent("started a run")
    expect(screen.queryByText(/posted a message/)).not.toBeInTheDocument()
    expect(screen.getByText(/2 of 3 events match/)).toBeInTheDocument()
  })

  it("composes search with the kind filter", async () => {
    mockQuery({
      data: buildHome({
        activity: [
          buildEvent({ id: "evt_1", kind: "file", summary: "uploaded README.md" }),
          buildEvent({
            id: "evt_2",
            kind: "agent",
            actor: { id: "usr_02", name: "Readme Bot" },
            summary: "readme sync run",
            target: undefined,
          }),
        ],
      }),
    })

    render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.selectOptions(screen.getByLabelText("Filter by type"), "agent")
    await userEvent.type(screen.getByLabelText("Search activity"), "readme")

    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent("Readme Bot")
    expect(items[0]).toHaveTextContent("readme sync run")
    expect(screen.getByText(/1 of 1 event match/)).toBeInTheDocument()
  })

  it("clears the search with Escape", async () => {
    mockQuery({ data: buildHome() })

    render(<ProjectActivityScreen projectId="prj_01" />)

    const search = screen.getByLabelText("Search activity")
    await userEvent.type(search, "readme{Escape}")

    expect(search).toHaveValue("")
    expect(screen.getByText(/uploaded README\.md/)).toBeInTheDocument()
  })

  it("offers to clear search and kind filter when nothing matches", async () => {
    mockQuery({ data: buildHome({ activity: [buildEvent()] }) })

    render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.type(screen.getByLabelText("Search activity"), "zzz")

    expect(screen.getByRole("heading", { name: "No matching activity" })).toBeInTheDocument()
    expect(screen.getByText(/No events match "zzz"\./)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Show all activity" }))

    expect(screen.getByLabelText("Search activity")).toHaveValue("")
    expect(screen.getByText(/uploaded README\.md/)).toBeInTheDocument()
  })

  it("highlights search matches in the feed", async () => {
    mockQuery({ data: buildHome() })

    const { container } = render(<ProjectActivityScreen projectId="prj_01" />)

    await userEvent.type(screen.getByLabelText("Search activity"), "readme")

    const marks = container.querySelectorAll("mark.app-activity-mark")
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0]).toHaveTextContent("README")
  })

  it("shows the empty state linking to files when there is no activity", () => {
    mockQuery({ data: buildHome({ activity: [] }) })

    render(<ProjectActivityScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "No recent activity" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open files" })).toHaveAttribute(
      "href",
      "/projects/prj_01/files",
    )
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })
})
