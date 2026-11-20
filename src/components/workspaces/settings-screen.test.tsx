import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceSettingsScreen } from "./settings-screen"

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }
const settings = {
  allowMemberInvites: false,
  defaultJoinRole: "member" as const,
  displayLabel: "",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    workspace,
    role: "owner",
    memberCount: 3,
    settings,
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("WorkspaceSettingsScreen", () => {
  it("loads workspace settings and renders editable fields for an owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<WorkspaceSettingsScreen workspaceId="ws-1" />)

    expect(await screen.findByLabelText("Workspace name")).toHaveValue("Research team")
    expect(screen.getByLabelText("Display label")).toBeInTheDocument()
    expect(screen.getByLabelText("Default role for invitees")).toHaveValue("member")
    expect(screen.getByRole("switch", { name: "Members can send invites" })).toBeEnabled()
    expect(screen.getByText("owner")).toBeInTheDocument()
    expect(screen.getByText("3 members")).toBeInTheDocument()
    // Nothing changed yet — save stays disabled.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("renders read-only controls and a note for members", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload({ role: "member" })))

    render(<WorkspaceSettingsScreen workspaceId="ws-1" />)

    expect(await screen.findByLabelText("Workspace name")).toBeDisabled()
    expect(screen.getByLabelText("Display label")).toBeDisabled()
    expect(screen.getByLabelText("Default role for invitees")).toBeDisabled()
    expect(screen.getByRole("switch", { name: "Members can send invites" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByText(/read-only/)).toBeInTheDocument()
  })

  it("sends only the changed name in the PATCH body", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload()))
      }
      if (url === "/api/workspaces/ws-1" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse(
            payload({
              workspace: { ...workspace, name: "Renamed team" },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspaceSettingsScreen workspaceId="ws-1" />)

    const nameInput = await screen.findByLabelText("Workspace name")
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, "Renamed team")

    const saveButton = screen.getByRole("button", { name: "Save changes" })
    expect(saveButton).toBeEnabled()
    await userEvent.click(saveButton)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Renamed team" }),
        }),
      ),
    )
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  })

  it("sends only the changed settings keys in the PATCH body", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload()))
      }
      if (url === "/api/workspaces/ws-1" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse(
            payload({
              settings: { ...settings, allowMemberInvites: true, displayLabel: "Acme" },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspaceSettingsScreen workspaceId="ws-1" />)

    await userEvent.click(await screen.findByRole("switch", { name: "Members can send invites" }))
    await userEvent.type(screen.getByLabelText("Display label"), "Acme")
    await userEvent.selectOptions(screen.getByLabelText("Default role for invitees"), "member")

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            settings: { allowMemberInvites: true, displayLabel: "Acme" },
          }),
        }),
      ),
    )
  })

  it("shows an error state with retry when loading fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Boom" }, 500))

    render(<WorkspaceSettingsScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Boom")).toBeInTheDocument()
    fetchMock.mockResolvedValue(jsonResponse(payload()))
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByLabelText("Workspace name")).toHaveValue("Research team")
  })
})
