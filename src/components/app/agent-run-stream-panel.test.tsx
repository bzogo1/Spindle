import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentStreamEntry } from "@/lib/agent-log-stream"
import { clientEnv } from "@/lib/env"
import { useAgentRunStream } from "@/lib/use-agent-run-stream"

import { AgentRunStreamPanel } from "./agent-run-stream-panel"

vi.mock("@/lib/use-agent-run-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/use-agent-run-stream")>()
  return { ...actual, useAgentRunStream: vi.fn() }
})

// The panel only mounts its stream UI when a real backend is configured;
// default the suite to http mode and flip to mock per-test.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>()
  return {
    ...actual,
    clientEnv: { ...actual.clientEnv, NEXT_PUBLIC_API_MODE: "http" },
  }
})

const streamQuery = vi.mocked(useAgentRunStream)

function buildEntry(overrides: Partial<AgentStreamEntry> = {}): AgentStreamEntry {
  return {
    id: "evt_1",
    timestamp: "2026-11-19T12:00:00.000Z",
    level: "info",
    source: "agent",
    kind: "log",
    message: "Reading survey.parquet",
    ...overrides,
  }
}

function mockStream(overrides: Partial<ReturnType<typeof useAgentRunStream>> = {}) {
  streamQuery.mockReturnValue({
    entries: [],
    status: "live",
    lastEventAt: null,
    error: null,
    cancel: vi.fn(async () => true),
    resolveApproval: vi.fn(async () => true),
    reset: vi.fn(),
    ...overrides,
  })
}

describe("AgentRunStreamPanel", () => {
  beforeEach(() => {
    streamQuery.mockReset()
    clientEnv.NEXT_PUBLIC_API_MODE = "http"
  })

  it("renders streamed entries and filters them live", async () => {
    mockStream({
      entries: [
        buildEntry(),
        buildEntry({ id: "evt_2", message: "Query took 4s", level: "warn", source: "tool" }),
      ],
    })
    render(<AgentRunStreamPanel runId="run_1" />)

    expect(screen.getByText("Reading survey.parquet")).toBeInTheDocument()
    expect(screen.getByText("Query took 4s")).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Filter log entries"), "survey")
    const log = screen.getByRole("log")
    expect(log).toHaveTextContent("Reading survey.parquet")
    expect(log).not.toHaveTextContent("Query took 4s")
    expect(screen.getByText("survey")).toBeInTheDocument() // <mark> highlight
  })

  it("shows the cancel button while live and calls cancel", async () => {
    const cancel = vi.fn(async () => true)
    mockStream({ status: "live", cancel })
    render(<AgentRunStreamPanel runId="run_1" />)

    await userEvent.click(screen.getByRole("button", { name: "Cancel run" }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("hides cancel for finished streams", () => {
    mockStream({ status: "done" })
    render(<AgentRunStreamPanel runId="run_1" />)
    expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument()
  })

  it("hides cancel and humanizes the error when the stream is unavailable", () => {
    mockStream({ status: "unavailable", error: "ws_closed_1006" })
    render(<AgentRunStreamPanel runId="run_1" />)

    expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument()
    // The label appears in both the header line and the status badge.
    expect(screen.getAllByText("Stream unavailable").length).toBeGreaterThan(0)
    expect(screen.getByText("The live event stream disconnected (code 1006).")).toBeInTheDocument()
    expect(screen.queryByText("ws_closed_1006")).not.toBeInTheDocument()
  })

  it("renders nothing and keeps the stream disabled under the mock adapter", () => {
    clientEnv.NEXT_PUBLIC_API_MODE = "mock"
    mockStream({ status: "live" })
    const { container } = render(<AgentRunStreamPanel runId="run_1" />)

    expect(container).toBeEmptyDOMElement()
    expect(streamQuery).toHaveBeenCalledWith("run_1", { enabled: false })
  })

  it("renders an approval card and posts the decision", async () => {
    const resolveApproval = vi.fn(async () => true)
    mockStream({
      status: "live",
      resolveApproval,
      entries: [
        buildEntry({
          id: "ap1",
          kind: "approval_required",
          message: "Approval requested",
          data: {
            approvalId: "appr_1",
            action: "delete_file",
            summary: "Delete old export",
            status: "pending",
          },
        }),
      ],
    })
    render(<AgentRunStreamPanel runId="run_1" />)

    expect(screen.getByText("Approval required")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(resolveApproval).toHaveBeenCalledWith("appr_1", "approved")
    expect(screen.getByRole("status")).toHaveTextContent("approved")
  })

  it("shows resolved approvals without actions", () => {
    mockStream({
      entries: [
        buildEntry({
          id: "ap1",
          kind: "approval_required",
          data: {
            approvalId: "appr_1",
            action: "delete_file",
            summary: "Done",
            status: "rejected",
          },
        }),
      ],
    })
    render(<AgentRunStreamPanel runId="run_1" />)
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    expect(screen.getByText("rejected")).toBeInTheDocument()
  })
})
