import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, useAgentRunLog, useAgentRunLogEntry } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { AgentRunLogEntry, AgentWorkspace } from "@/lib/api/types"

import { AgentRunDetailScreen } from "./agent-run-detail-screen"
import { AgentRunLogScreen } from "./agent-run-log-screen"

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
    useAgentRunLog: vi.fn(),
    useAgentRunLogEntry: vi.fn(),
  }
})

const listQuery = vi.mocked(useAgentRunLog)
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
        payload: { path: "docs/methods.md" },
      },
    ],
    approval: null,
    summary: "Done.",
    ...overrides,
  }
}

function mockListQuery(overrides: Partial<ReturnType<typeof useAgentRunLog>>) {
  listQuery.mockReturnValue({
    status: "success",
    mode: "ready",
    data: [buildRun()],
    error: undefined,
    isRetrying: false,
    refetch: vi.fn(),
    ...overrides,
  })
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

describe("AgentRunLogScreen", () => {
  beforeEach(() => {
    listQuery.mockReset()
    navigationMocks.push.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows the loading state", () => {
    mockListQuery({ status: "loading", mode: "loading", data: undefined })
    render(<AgentRunLogScreen />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading agent runs")
  })

  it("shows the error state and retries", async () => {
    const refetch = vi.fn()
    mockListQuery({
      status: "error",
      mode: "error",
      data: undefined,
      error: new ApiError({
        status: 500,
        code: "server_error",
        message: "Boom",
        requestId: "req_runlog",
      }),
      refetch,
    })
    render(<AgentRunLogScreen />)
    expect(screen.getByRole("alert")).toHaveTextContent("Agent did not load")
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state when there are no runs", () => {
    mockListQuery({ data: [] })
    render(<AgentRunLogScreen />)
    expect(screen.getByText("No agent runs yet")).toBeInTheDocument()
  })

  it("renders runs with status badges and filters by project", async () => {
    mockListQuery({
      data: [
        buildRun(),
        buildRun({
          id: "runlog_02",
          projectId: "prj_02",
          projectName: "Tide Model Archive",
          prompt: "Rebuild the calibration replay",
          status: "failed",
        }),
      ],
    })
    render(<AgentRunLogScreen />)

    expect(screen.getByRole("heading", { name: "Agent runs" })).toBeInTheDocument()
    expect(screen.getByText("Draft the methods section")).toBeInTheDocument()
    expect(screen.getByText("Rebuild the calibration replay")).toBeInTheDocument()
    expect(screen.getAllByText("succeeded")).toHaveLength(1)
    expect(screen.getAllByText("failed")).toHaveLength(1)

    await userEvent.selectOptions(screen.getByLabelText("Filter by project"), "prj_02")
    expect(screen.queryByText("Draft the methods section")).not.toBeInTheDocument()
    expect(screen.getByText("Rebuild the calibration replay")).toBeInTheDocument()
  })

  it("filters by status and composes with pagination", async () => {
    const user = userEvent.setup()
    mockListQuery({
      data: [
        ...Array.from({ length: 12 }, (_, index) =>
          buildRun({
            id: `runlog_ok_${index + 1}`,
            prompt: `Succeeded run ${index + 1}`,
            status: "succeeded",
          }),
        ),
        buildRun({ id: "runlog_fail_1", prompt: "Failed run", status: "failed" }),
      ],
    })
    render(<AgentRunLogScreen />)

    expect(screen.getByText("Showing 1–10 of 13")).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("Filter by status"), "failed")

    expect(screen.getByText("Failed run")).toBeInTheDocument()
    expect(screen.queryByText("Succeeded run 1")).not.toBeInTheDocument()
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument()
  })

  it("paginates the run history list", async () => {
    const user = userEvent.setup()
    mockListQuery({
      data: Array.from({ length: 12 }, (_, index) =>
        buildRun({
          id: `runlog_${index + 1}`,
          prompt: `Run prompt ${index + 1}`,
        }),
      ),
    })
    render(<AgentRunLogScreen />)

    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument()
    expect(screen.getByText("Run prompt 1")).toBeInTheDocument()
    expect(screen.queryByText("Run prompt 11")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Go to previous page" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Go to next page" }))

    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument()
    expect(screen.getByText("Run prompt 11")).toBeInTheDocument()
    expect(screen.queryByText("Run prompt 1")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Go to next page" })).toBeDisabled()

    await user.click(screen.getByRole("link", { name: "1" }))
    expect(screen.getByText("Run prompt 1")).toBeInTheDocument()
  })

  it("caps run selection at two runs", async () => {
    const user = userEvent.setup()
    mockListQuery({
      data: [
        buildRun({ id: "runlog_a", prompt: "Run A" }),
        buildRun({ id: "runlog_b", prompt: "Run B" }),
        buildRun({ id: "runlog_c", prompt: "Run C" }),
      ],
    })
    render(<AgentRunLogScreen />)

    await user.click(screen.getByRole("checkbox", { name: "Select Run A for comparison" }))
    expect(screen.getByText("1 of 2 runs selected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Compare runs" })).toBeDisabled()

    await user.click(screen.getByRole("checkbox", { name: "Select Run B for comparison" }))
    expect(screen.getByText("2 of 2 runs selected")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Compare runs" })).toBeEnabled()

    const thirdCheckbox = screen.getByRole("checkbox", {
      name: "Select Run C for comparison",
    })
    expect(thirdCheckbox).toBeDisabled()
    expect(thirdCheckbox).toHaveAttribute("aria-checked", "false")

    // Unchecking one frees a slot again.
    await user.click(screen.getByRole("checkbox", { name: "Select Run A for comparison" }))
    expect(screen.getByRole("checkbox", { name: "Select Run C for comparison" })).toBeEnabled()
  })

  it("keeps the selection across pagination and filter changes", async () => {
    const user = userEvent.setup()
    mockListQuery({
      data: Array.from({ length: 12 }, (_, index) =>
        buildRun({
          id: `runlog_${index + 1}`,
          prompt: `Run prompt ${index + 1}`,
        }),
      ),
    })
    render(<AgentRunLogScreen />)

    await user.click(screen.getByRole("checkbox", { name: "Select Run prompt 1 for comparison" }))
    await user.click(screen.getByRole("button", { name: "Go to next page" }))

    expect(screen.getByText("Run prompt 11")).toBeInTheDocument()
    expect(screen.getByText("1 of 2 runs selected")).toBeInTheDocument()

    await user.click(screen.getByRole("checkbox", { name: "Select Run prompt 11 for comparison" }))
    expect(screen.getByText("2 of 2 runs selected")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Go to previous page" }))
    expect(
      screen.getByRole("checkbox", { name: "Select Run prompt 1 for comparison" }),
    ).toBeChecked()

    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.queryByText(/runs selected/)).not.toBeInTheDocument()
  })

  it("offers cancel only on active runs and refreshes after confirming", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    const cancelAgentRunLogEntry = vi
      .spyOn(api.dashboard, "cancelAgentRunLogEntry")
      .mockResolvedValue(buildRun({ status: "cancelled", finishedAt: now }))
    mockListQuery({
      data: [
        buildRun({ id: "runlog_live", prompt: "Live run", status: "running", finishedAt: null }),
        buildRun({ id: "runlog_done", prompt: "Done run", status: "succeeded" }),
      ],
      refetch,
    })
    render(<AgentRunLogScreen />)

    // Only the active run gets a cancel action.
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Cancel" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Cancel agent run")
    expect(cancelAgentRunLogEntry).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Cancel run" }))

    expect(cancelAgentRunLogEntry).toHaveBeenCalledWith("runlog_live")
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("replays a finished run from its row and opens the project agent page", async () => {
    const user = userEvent.setup()
    const startAgentRun = vi
      .spyOn(api.workspace, "startAgentRun")
      .mockResolvedValue({} as AgentWorkspace)
    mockListQuery({
      data: [
        buildRun({ id: "runlog_live", prompt: "Live run", status: "running", finishedAt: null }),
        buildRun({ id: "runlog_done", prompt: "Done run", status: "succeeded" }),
      ],
    })
    render(<AgentRunLogScreen />)

    // Only the finished run gets a replay action.
    expect(screen.getAllByRole("button", { name: "Replay" })).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Replay" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("Replay agent run")
    expect(startAgentRun).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Replay run" }))

    expect(startAgentRun).toHaveBeenCalledWith("prj_01", "Done run")
    expect(navigationMocks.push).toHaveBeenCalledWith("/projects/prj_01/agent")
  })

  it("copies a shareable link from each run row", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    mockListQuery({
      data: [
        buildRun({ id: "runlog_a", prompt: "Run A" }),
        buildRun({ id: "runlog_b", prompt: "Run B", projectName: "Tide Model Archive" }),
      ],
    })
    render(<AgentRunLogScreen />)

    const shareButtons = screen.getAllByRole("button", { name: "Copy link" })
    expect(shareButtons).toHaveLength(2)

    await user.click(shareButtons[1])

    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/app/agent/runlog_b`)
  })

  it("shows reported cost per run and a usage total for the filtered list", () => {
    mockListQuery({
      data: [
        buildRun({
          id: "runlog_costed",
          prompt: "Costed run",
          usage: {
            model: "gpt-4o",
            inputTokens: 8000,
            outputTokens: 2000,
            totalTokens: 10000,
            costUsd: 0.04,
          },
        }),
        buildRun({ id: "runlog_plain", prompt: "Uncosted run" }),
      ],
    })
    render(<AgentRunLogScreen />)

    // Costed row shows its cost; the uncosted row falls back to a dash.
    const costedRow = screen.getByText("Costed run").closest("li")
    expect(costedRow).not.toBeNull()
    expect(within(costedRow as HTMLElement).getByText("$0.04")).toBeInTheDocument()
    const plainRow = screen.getByText("Uncosted run").closest("li")
    expect(plainRow).not.toBeNull()

    expect(screen.getByTestId("runlog-cost-total")).toHaveTextContent(
      "1 of 2 runs report usage · total cost $0.04 · 10.0k tokens",
    )
  })

  it("hides the cost total when no run reports usage", () => {
    mockListQuery({ data: [buildRun()] })
    render(<AgentRunLogScreen />)
    expect(screen.queryByTestId("runlog-cost-total")).not.toBeInTheDocument()
  })

  it("compares two selected runs in a dialog", async () => {
    const user = userEvent.setup()
    mockListQuery({
      data: [
        buildRun({
          id: "runlog_a",
          prompt: "Draft the methods section",
          status: "succeeded",
          actor: { id: "usr_01", name: "Alice Researcher" },
          summary: "Drafted all three sections.",
          approval: {
            id: "appr_a",
            action: "delete_file",
            summary: "Delete an old draft.",
            requestedAt: "2026-11-19T09:31:00.000Z",
            status: "approved",
          },
        }),
        buildRun({
          id: "runlog_b",
          prompt: "Rebuild the calibration archive",
          projectName: "Tide Model Archive",
          status: "failed",
          actor: { id: "usr_02", name: "Bob Analyst" },
          createdAt: "2026-11-19T10:00:00.000Z",
          startedAt: "2026-11-19T10:00:02.000Z",
          finishedAt: "2026-11-19T10:00:30.000Z",
          steps: [
            {
              id: "b1",
              kind: "result",
              title: "Calibration failed",
              detail: "Solver diverged.",
              status: "failed",
              startedAt: "2026-11-19T10:00:05.000Z",
              durationMs: 500,
            },
          ],
          summary: "Solver diverged before writing outputs.",
          approval: null,
        }),
      ],
    })
    render(<AgentRunLogScreen />)

    await user.click(
      screen.getByRole("checkbox", { name: "Select Draft the methods section for comparison" }),
    )
    await user.click(
      screen.getByRole("checkbox", {
        name: "Select Rebuild the calibration archive for comparison",
      }),
    )
    await user.click(screen.getByRole("button", { name: "Compare runs" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Compare agent runs")).toBeInTheDocument()

    expect(within(dialog).getByText("Draft the methods section")).toBeInTheDocument()
    expect(within(dialog).getByText("Rebuild the calibration archive")).toBeInTheDocument()

    // Both runs' fields are rendered side by side.
    expect(within(dialog).getByText("Alice Researcher")).toBeInTheDocument()
    expect(within(dialog).getByText("Bob Analyst")).toBeInTheDocument()
    expect(within(dialog).getByText("Tide Model Archive")).toBeInTheDocument()
    expect(within(dialog).getByText("Drafted all three sections.")).toBeInTheDocument()
    expect(within(dialog).getByText("Solver diverged before writing outputs.")).toBeInTheDocument()
    expect(within(dialog).getByText("delete file · approved")).toBeInTheDocument()
    expect(within(dialog).getAllByText("succeeded")).toHaveLength(1)
    expect(within(dialog).getAllByText("failed")).toHaveLength(1)
    // Step counts differ: run A has 2 steps, run B has 1.
    const facts = within(dialog).getAllByRole("definition")
    expect(facts.some((node) => node.textContent === "2")).toBe(true)
    expect(facts.some((node) => node.textContent === "1")).toBe(true)

    // Each column links to the run detail page.
    const detailLinks = within(dialog).getAllByRole("link", { name: "Open run detail" })
    expect(detailLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/app/agent/runlog_a",
      "/app/agent/runlog_b",
    ])
  })
})

describe("AgentRunDetailScreen", () => {
  beforeEach(() => {
    detailQuery.mockReset()
  })

  it("renders the timeline with expandable steps", async () => {
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)

    expect(screen.getByRole("heading", { name: "Draft the methods section" })).toBeInTheDocument()
    expect(screen.getByText("Planned the draft")).toBeInTheDocument()
    expect(screen.getByText("Write docs/methods.md")).toBeInTheDocument()

    const details = screen.getByText("Write docs/methods.md").closest("details")
    expect(details).not.toBeNull()
    expect(details).toHaveTextContent('"path": "docs/methods.md"')
  })

  it("renders the cost panel with totals and a per-kind breakdown", () => {
    mockDetailQuery({
      data: buildRun({
        usage: {
          model: "gpt-4o",
          provider: "openai",
          inputTokens: 8000,
          outputTokens: 2000,
          totalTokens: 10000,
          costUsd: 0.04,
        },
        steps: [
          {
            id: "s1",
            kind: "thought",
            title: "Planned the draft",
            detail: "Read the outline first.",
            status: "done",
            startedAt: "2026-11-19T09:30:01.000Z",
            durationMs: 1200,
            tokens: 900,
            costUsd: 0.005,
          },
          {
            id: "s2",
            kind: "tool_call",
            title: "Write docs/methods.md",
            detail: "Wrote the methods section.",
            status: "done",
            startedAt: "2026-11-19T09:30:03.000Z",
            durationMs: 9000,
            tokens: 4200,
            costUsd: 0.03,
          },
        ],
      }),
    })
    render(<AgentRunDetailScreen runId="runlog_01" />)

    expect(screen.getByRole("heading", { name: /Cost & usage/ })).toBeInTheDocument()
    expect(screen.getByTestId("run-cost-usd")).toHaveTextContent("$0.04")
    expect(screen.getByTestId("run-cost-tokens")).toHaveTextContent("10.0k")
    expect(screen.getByText("gpt-4o")).toBeInTheDocument()

    // Per-kind breakdown sums the recorded step fields (scoped away from the
    // timeline, which also renders per-step costs).
    const breakdown = screen.getByTestId("run-cost-breakdown")
    expect(within(breakdown).getByText("By step kind")).toBeInTheDocument()
    expect(within(breakdown).getByText("Thought")).toBeInTheDocument()
    expect(within(breakdown).getByText("Tool call")).toBeInTheDocument()
    expect(within(breakdown).getByText("$0.0050")).toBeInTheDocument()
    expect(within(breakdown).getByText("$0.03")).toBeInTheDocument()
  })

  it("shows an empty note in the cost panel when no usage is recorded", () => {
    mockDetailQuery({})
    render(<AgentRunDetailScreen runId="runlog_01" />)
    expect(screen.getByText("No usage data recorded for this run yet.")).toBeInTheDocument()
  })

  it("shows the approval card and records a UI-only decision", async () => {
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

    expect(screen.getByText("Approval required")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(screen.getByRole("status")).toHaveTextContent("approved")
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument()
  })
})
