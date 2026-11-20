import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DangerZoneScreen } from "./danger-zone-screen"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

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
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  push.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("DangerZoneScreen", () => {
  it("loads the workspace and shows warnings plus the export link", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload()))
    render(<DangerZoneScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Danger zone")).toBeInTheDocument()
    expect(screen.getByText(/permanent and cannot be undone/i)).toBeInTheDocument()
    expect(screen.getByText(/every member loses access/i)).toBeInTheDocument()
    const exportLink = screen.getByRole("link", { name: /download workspace data first/i })
    expect(exportLink).toHaveAttribute("href", "/app/workspaces/ws-1/export")
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws-1", { cache: "no-store" })
  })

  it("keeps the delete button disabled until the exact name is typed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload()))
    render(<DangerZoneScreen workspaceId="ws-1" />)

    const button = await screen.findByRole("button", { name: "Delete workspace" })
    expect(button).toBeDisabled()

    const input = screen.getByLabelText(/type/i)
    await userEvent.type(input, "research team")
    expect(button).toBeDisabled()

    await userEvent.clear(input)
    await userEvent.type(input, "Research team")
    expect(button).toBeEnabled()
  })

  it("requires a two-step confirm before deleting and redirects on success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse({ ok: true, deleted: true }))
    render(<DangerZoneScreen workspaceId="ws-1" />)

    await userEvent.type(await screen.findByLabelText(/type/i), "Research team")
    await userEvent.click(screen.getByRole("button", { name: "Delete workspace" }))

    // First click only arms the inline confirm — no request yet.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert")).toHaveTextContent(/permanently delete research team/i)

    await userEvent.click(screen.getByRole("button", { name: "Permanently delete" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workspaces/ws-1/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "Research team" }),
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/workspaces"))
  })

  it("shows an error toast and stays put when deletion fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, code: "invalid_input", message: "Name mismatch." }, 400),
      )
    render(<DangerZoneScreen workspaceId="ws-1" />)

    await userEvent.type(await screen.findByLabelText(/type/i), "Research team")
    await userEvent.click(screen.getByRole("button", { name: "Delete workspace" }))
    await userEvent.click(screen.getByRole("button", { name: "Permanently delete" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Permanently delete" })).not.toBeInTheDocument(),
    )
    expect(push).not.toHaveBeenCalled()
  })

  it("shows explanatory text and no delete form for non-owners", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload({ role: "admin" })))
    render(<DangerZoneScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/only the workspace owner can delete/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Delete workspace" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/type/i)).not.toBeInTheDocument()
  })

  it("shows an error state with retry when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, code: "forbidden", message: "Not a member." }, 403),
    )
    render(<DangerZoneScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Workspace unavailable")).toBeInTheDocument()
    expect(screen.getByText("Not a member.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })
})
