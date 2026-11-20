import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceExportScreen } from "./export-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const WORKSPACE = { id: "ws-1", name: "Research team", slug: "research-team" }

const EXPORT_PAYLOAD = {
  exportedAt: "2026-03-01T00:00:00.000Z",
  workspace: WORKSPACE,
  settings: {
    allowMemberInvites: false,
    defaultJoinRole: "member",
    displayLabel: "",
  },
  members: [{ user: { id: "u1", email: "ada@example.com", name: "Ada" }, role: "owner" }],
}

let fetchMock: ReturnType<typeof vi.fn>
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

function mockFetch(role: string, opts: { infoStatus?: number; exportStatus?: number } = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === "/api/workspaces/ws-1") {
      if (opts.infoStatus && opts.infoStatus !== 200) {
        return Promise.resolve(jsonResponse({ ok: false, message: "Nope" }, opts.infoStatus))
      }
      return Promise.resolve(
        jsonResponse({
          ok: true,
          workspace: WORKSPACE,
          role,
          memberCount: 2,
        }),
      )
    }
    if (url === "/api/workspaces/ws-1/export") {
      if (opts.exportStatus && opts.exportStatus !== 200) {
        return Promise.resolve(
          jsonResponse({ ok: false, message: "Export denied" }, opts.exportStatus),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(EXPORT_PAYLOAD, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-disposition": 'attachment; filename="workspace-research-team-export.json"',
          },
        }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: false }, 404))
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  createObjectURL = vi.fn(() => "blob:mock-export")
  revokeObjectURL = vi.fn()
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("WorkspaceExportScreen", () => {
  it("shows a download button to owners and downloads the JSON", async () => {
    mockFetch("owner")
    const user = userEvent.setup()
    render(<WorkspaceExportScreen workspaceId="ws-1" />)

    const button = await screen.findByRole("button", { name: /download json/i })
    expect(screen.getByText(/member roster/i)).toBeInTheDocument()

    await user.click(button)

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-export")
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1/export", {
      cache: "no-store",
    })
  })

  it("shows insufficient permissions for members", async () => {
    mockFetch("member")
    render(<WorkspaceExportScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Insufficient permissions")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /download json/i })).not.toBeInTheDocument()
  })

  it("shows an error state with retry when workspace info fails", async () => {
    mockFetch("owner", { infoStatus: 500 })
    const user = userEvent.setup()
    render(<WorkspaceExportScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Workspace information unavailable")).toBeInTheDocument()

    // Retry succeeds once the backend recovers.
    mockFetch("owner")
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByRole("button", { name: /download json/i })).toBeInTheDocument()
  })

  it("surfaces export errors without triggering a download", async () => {
    mockFetch("admin", { exportStatus: 403 })
    const user = userEvent.setup()
    render(<WorkspaceExportScreen workspaceId="ws-1" />)

    await user.click(await screen.findByRole("button", { name: /download json/i }))

    expect(await screen.findByText("Export denied")).toBeInTheDocument()
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
