import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProjectHome } from "@/lib/api"
import { ApiError } from "@/lib/api/client"
import type { ProjectHomeData } from "@/lib/api/types"

import { ProjectGuard } from "./project-guard"

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  notFound: () => mocks.notFound(),
}))

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

function buildHome(): ProjectHomeData {
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
    activity: [],
    storageBytes: 0,
    generatedAt: now,
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

describe("ProjectGuard", () => {
  beforeEach(() => {
    homeQuery.mockReset()
    mocks.notFound.mockReset()
  })

  it("renders children once the project resolves", () => {
    mockQuery()

    render(
      <ProjectGuard projectId="prj_01">
        <p>Project screen content</p>
      </ProjectGuard>,
    )

    expect(screen.getByText("Project screen content")).toBeInTheDocument()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it("shows the loading panel while the project query is pending", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })

    render(
      <ProjectGuard projectId="prj_01">
        <p>Project screen content</p>
      </ProjectGuard>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Loading project")
    expect(screen.queryByText("Project screen content")).not.toBeInTheDocument()
  })

  it("shows the retryable error state for non-404 failures", async () => {
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

    render(
      <ProjectGuard projectId="prj_01">
        <p>Project screen content</p>
      </ProjectGuard>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Project did not load")
    expect(mocks.notFound).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("calls notFound instead of the error state when the project is absent", () => {
    mockQuery({
      status: "error",
      mode: "error",
      data: undefined,
      error: new ApiError({
        status: 404,
        code: "not_found",
        message: "Project not found.",
        requestId: "req_missing",
      }),
    })
    const sentinel = new Error("NEXT_NOT_FOUND")
    mocks.notFound.mockImplementation(() => {
      throw sentinel
    })

    expect(() =>
      render(
        <ProjectGuard projectId="prj_missing">
          <p>Project screen content</p>
        </ProjectGuard>,
      ),
    ).toThrow("NEXT_NOT_FOUND")

    expect(mocks.notFound).toHaveBeenCalled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("still shows the retryable error state for network failures without a status", () => {
    mockQuery({
      status: "error",
      mode: "error",
      data: undefined,
      error: new ApiError({
        status: null,
        code: "network_error",
        message: "The request could not reach the server.",
      }),
    })

    render(
      <ProjectGuard projectId="prj_01">
        <p>Project screen content</p>
      </ProjectGuard>,
    )

    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Project did not load")
  })
})
