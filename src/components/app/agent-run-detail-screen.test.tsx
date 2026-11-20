import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, useAgentRunLogEntry } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { AgentRunLogEntry, AgentWorkspace } from "@/lib/api/types"

import { AgentRunDetailScreen } from "./agent-run-detail-screen"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    useAgentRunLogEntry: vi.fn(),
  }
})

const detailQuery = vi.mocked(useAgentRunLogEntry)

const now = "2026-11-19T12:00:00.000Z"

function buildRun(overrides: Partial<AgentRunLogEntry> = {}): AgentRunLogEntry {
  return {
    id: "runlog_01",
    projectId: "prj_01",
    projectName: "Coastal Resilience",
    prompt: "Draft the methods section",
    status: "succeeded",
    actor: { id: "usr_01", name: "Bogdan Zogovic" },
    createdAt: "2026-11-19T09:30:00.000Z",
    startedAt: "2026-11-19T09:30:01.000Z",
    finishedAt: "2026-11-19T09:34:00.000Z",
    steps: [
      {
        id: "s1",
        kind: "thought",
        title: "Planned the draft",
        detail: "Read the outline first.",
        status: "done",
        startedAt: "2026-11-19T09:30:01.000Z",
        durationMs: 1200,
      },
      {
        id: "s2",
        kind: "tool_call",
        title: "Write docs/methods.md",
        detail: "Wrote the methods section.",
        status: "done",
        startedAt: "2026-11-19T09:30:03.000Z",
        durationMs: 9000,
        payload: {
          path: "docs/methods.md",
          diff: "@@ -1,3 +1,4 @@\n # Methods\n+We calibrated against tide gauges.",
        },
      },
      {
        id: "s3",
        kind: "result",
        title: "Run finished",
        detail: "Summary ready for review.",
        status: "done",
        startedAt: "2026-11-19T09:33:50.000Z",
        durationMs: 500,
      },
    ],
    approval: null,
    summary: "Done.",
    ...overrides,
  }
}

function mockDetailQuery(overrides: Partial<ReturnType<typeof useAgentRunLogEntry>>) {
  detailQuery.mockReturnValue({
    status: "success",
    mode: "ready",
    data: buildRun(),
    error: undefined,
    isRetrying: false,
    refetch: vi.fn(),
    ...overrides,
  })
}

describe("AgentRunDetailScreen", () => {
  beforeEach(() => {
    detailQuery.mockReset()
    navigationMocks.push.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the loading state", () => {
    mockDetailQuery({ status: "loading", mode: "loading", data: undefined })
    render(<AgentRunDetailScreen runId="runlog_01" />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading agent runs")
  })

  it("shows the error state and retries", async () => {
    const refetch = vi.fn()
    mockDetailQuery({
      status: "error",
      mode: "error",
      data: undefined,
      error: new ApiError({
        status: 500,
        code: "server_error",
        message: "Boom",
        requestId: "req_runlog_detail",
      }),
      refetch,
    })
    render(<AgentRunDetailScreen runId="runlog_01" />)
    expect(screen.getByRole("alert")).toHaveTextContent("Agent did not load")
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("renders the run header, timeline steps, and step payload", () => {
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)

    expect(screen.getByRole("heading", { name: "Draft the methods section" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Coastal Resilience" })).toHaveAttribute(
      "href",
      "/projects/prj_01",
    )
    expect(screen.getByRole("link", { name: /All agent runs/ })).toHaveAttribute(
      "href",
      "/app/agent",
    )
    // The actor name also appears inside the debug panel's raw JSON.
    expect(screen.getAllByText(/Bogdan Zogovic/).length).toBeGreaterThan(0)
    expect(screen.getByText("succeeded")).toBeInTheDocument()

    // Timeline: one row per step, with kind labels.
    expect(screen.getByText("Planned the draft")).toBeInTheDocument()
    expect(screen.getByText("Write docs/methods.md")).toBeInTheDocument()
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    // Kind labels appear in the row summary and again in the expanded facts.
    expect(screen.getAllByText("Thought")).toHaveLength(2)
    expect(screen.getAllByText("Tool call")).toHaveLength(2)
    expect(screen.getAllByText("Result")).toHaveLength(2)
    expect(
      screen.getByText(
        "3 steps — thoughts, tool calls, and results in order. Expand a row for details.",
      ),
    ).toBeInTheDocument()

    // Expanded step body exposes the structured payload (the diff).
    const details = screen.getByText("Write docs/methods.md").closest("details")
    expect(details).not.toBeNull()
    expect(details).toHaveTextContent('"path": "docs/methods.md"')
    expect(details).toHaveTextContent("calibrated against tide gauges")

    expect(screen.getByText("Done.")).toBeInTheDocument()
  })

  it("exposes debug affordances: raw run JSON and copy buttons", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)

    // Debug panel exposes the full run record as inspectable JSON.
    expect(screen.getByRole("heading", { name: "Debug" })).toBeInTheDocument()
    const rawJson = screen.getByText("Raw run JSON").closest("details")
    expect(rawJson).not.toBeNull()
    expect(rawJson).toHaveTextContent('"id": "runlog_01"')
    expect(rawJson).toHaveTextContent('"prompt": "Draft the methods section"')

    // Copy the run id from the page subtitle.
    await userEvent.click(screen.getByRole("button", { name: "Copy ID" }))
    expect(writeText).toHaveBeenLastCalledWith("runlog_01")

    // Copy a step's structured payload.
    await userEvent.click(screen.getByRole("button", { name: "Copy payload" }))
    const payloadArg = writeText.mock.calls.at(-1)?.[0] as string
    expect(JSON.parse(payloadArg)).toMatchObject({ path: "docs/methods.md" })

    // Copy the debug bundle — run record plus capture context.
    await userEvent.click(screen.getByRole("button", { name: "Copy debug info" }))
    const debugArg = JSON.parse(writeText.mock.calls.at(-1)?.[0] as string)
    expect(debugArg.run.id).toBe("runlog_01")
    expect(debugArg.capturedAt).toBeTruthy()
    expect(debugArg.page).toBe(window.location.href)
  })

  it("copies a shareable link to the run detail page", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }))

    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/app/agent/runlog_01`)
  })

  it("shows the empty-steps message when a run has no steps", () => {
    mockDetailQuery({ data: buildRun({ steps: [] }) })
    render(<AgentRunDetailScreen runId="runlog_01" />)
    expect(screen.getByText("No steps recorded for this run yet.")).toBeInTheDocument()
  })

  it("shows the approval card marked demo-only and records an approve decision", async () => {
    mockDetailQuery({
      data: buildRun({
        status: "waiting_approval",
        finishedAt: null,
        approval: {
          id: "appr_01",
          action: "delete_file",
          summary: "Delete tide-gauge-2019.csv before re-running calibration.",
          requestedAt: now,
          status: "pending",
        },
      }),
    })
    render(<AgentRunDetailScreen runId="runlog_02" />)

    const card = screen.getByRole("region", { name: "Approval request" })
    expect(card).toHaveTextContent("Approval required")
    expect(card).toHaveTextContent("delete file")
    expect(card).toHaveTextContent("Delete tide-gauge-2019.csv before re-running calibration.")
    expect(card).toHaveTextContent("Demo only — decisions are not sent anywhere yet.")

    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(screen.getByRole("status")).toHaveTextContent(
      "Decision recorded locally as “approved”. Nothing was executed — this is a UI demo.",
    )
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
  })

  it("records a reject decision on the approval card", async () => {
    mockDetailQuery({
      data: buildRun({
        status: "waiting_approval",
        finishedAt: null,
        approval: {
          id: "appr_02",
          action: "write_file",
          summary: "Overwrite docs/methods.md with the new draft.",
          requestedAt: now,
          status: "pending",
        },
      }),
    })
    render(<AgentRunDetailScreen runId="runlog_03" />)

    await userEvent.click(screen.getByRole("button", { name: "Reject" }))
    expect(screen.getByRole("status")).toHaveTextContent("rejected")
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
  })

  it("cancels an active run after confirmation and refreshes", async () => {
    const refetch = vi.fn()
    const cancelAgentRunLogEntry = vi
      .spyOn(api.dashboard, "cancelAgentRunLogEntry")
      .mockResolvedValue(
        buildRun({ status: "cancelled", finishedAt: now, summary: "Run cancelled." }),
      )
    mockDetailQuery({
      data: buildRun({ status: "running", finishedAt: null, summary: null }),
      refetch,
    })
    render(<AgentRunDetailScreen runId="runlog_01" />)

    await userEvent.click(screen.getByRole("button", { name: "Cancel run" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Cancel agent run")
    expect(cancelAgentRunLogEntry).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel run" }))

    expect(cancelAgentRunLogEntry).toHaveBeenCalledWith("runlog_01")
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("hides the cancel action for finished runs", () => {
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)
    expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument()
  })

  it("replays a finished run and opens the project agent page", async () => {
    const startAgentRun = vi
      .spyOn(api.workspace, "startAgentRun")
      .mockResolvedValue({} as AgentWorkspace)
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)

    await userEvent.click(screen.getByRole("button", { name: "Replay run" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Replay agent run")
    expect(dialog).toHaveTextContent("saved agent configuration")
    expect(startAgentRun).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole("button", { name: "Replay run" }))

    expect(startAgentRun).toHaveBeenCalledWith("prj_01", "Draft the methods section")
    expect(navigationMocks.push).toHaveBeenCalledWith("/projects/prj_01/agent")
  })

  it("hides the replay action for active runs", () => {
    mockDetailQuery({
      data: buildRun({ status: "running", finishedAt: null, summary: null }),
    })
    render(<AgentRunDetailScreen runId="runlog_01" />)
    expect(screen.queryByRole("button", { name: "Replay run" })).not.toBeInTheDocument()
  })

  it("renders a resolved approval without decision buttons", () => {
    mockDetailQuery({
      data: buildRun({
        approval: {
          id: "appr_03",
          action: "delete_file",
          summary: "Delete tide-gauge-2019.csv.",
          requestedAt: now,
          status: "approved",
        },
      }),
    })
    render(<AgentRunDetailScreen runId="runlog_04" />)

    const card = screen.getByRole("region", { name: "Approval request" })
    expect(card).toHaveTextContent("approved")
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Demo only/)).not.toBeInTheDocument()
  })
})
