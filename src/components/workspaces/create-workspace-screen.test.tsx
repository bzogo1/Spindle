import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CreateWorkspaceScreen } from "./create-workspace-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function createdWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws_abc123",
    name: "Acme Research",
    slug: "acme-research",
    role: "owner",
    active: true,
    ...overrides,
  }
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("CreateWorkspaceScreen", () => {
  it("shows a live slug preview that mirrors the backend slugify", async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceScreen />)

    const input = screen.getByLabelText("Workspace name")
    await user.type(input, "Acme Research!")

    expect(screen.getByText("Slug preview: acme-research")).toBeInTheDocument()
  })

  it("falls back to 'workspace' in the slug preview for non-alphanumeric names", async () => {
    const user = userEvent.setup()
    render(<CreateWorkspaceScreen />)

    await user.type(screen.getByLabelText("Workspace name"), "!!!")

    expect(screen.getByText("Slug preview: workspace")).toBeInTheDocument()
  })

  it("validates the name before submitting", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    render(<CreateWorkspaceScreen />)

    await user.click(screen.getByRole("button", { name: "Create workspace" }))

    expect(screen.getByText("Enter a workspace name.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts the trimmed name and shows the success state with settings and members links", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(jsonResponse({ ok: true, workspace: createdWorkspace() }))
    render(<CreateWorkspaceScreen />)

    await user.type(screen.getByLabelText("Workspace name"), "  Acme Research  ")
    await user.click(screen.getByRole("button", { name: "Create workspace" }))

    await screen.findByRole("link", { name: /Invite teammates/ })
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Acme Research" }),
    })
    expect(screen.getByText("Acme Research")).toBeInTheDocument()
    expect(screen.getByText("owner")).toBeInTheDocument()

    const invite = screen.getByRole("link", { name: /Invite teammates/ })
    expect(invite).toHaveAttribute("href", "/app/workspaces/ws_abc123/members")
    const settings = screen.getByRole("link", { name: "Workspace settings" })
    expect(settings).toHaveAttribute("href", "/app/workspaces/ws_abc123/settings")
  })

  it("surfaces API errors and retries the submission", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(
      jsonResponse({ ok: false, message: "Workspace limit reached." }, 400),
      jsonResponse({ ok: true, workspace: createdWorkspace() }),
    )
    render(<CreateWorkspaceScreen />)

    await user.type(screen.getByLabelText("Workspace name"), "Acme Research")
    await user.click(screen.getByRole("button", { name: "Create workspace" }))

    expect(await screen.findByText("Workspace limit reached.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Try again" }))

    await screen.findByRole("link", { name: /Invite teammates/ })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("resets back to the form via 'Create another workspace'", async () => {
    const user = userEvent.setup()
    mockFetch(jsonResponse({ ok: true, workspace: createdWorkspace() }))
    render(<CreateWorkspaceScreen />)

    await user.type(screen.getByLabelText("Workspace name"), "Acme Research")
    await user.click(screen.getByRole("button", { name: "Create workspace" }))
    await screen.findByRole("link", { name: /Invite teammates/ })

    await user.click(screen.getByRole("button", { name: "Create another workspace" }))

    expect(screen.getByLabelText("Workspace name")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeInTheDocument()
  })
})
