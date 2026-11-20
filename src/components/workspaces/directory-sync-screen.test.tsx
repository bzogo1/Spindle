import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DirectorySyncScreen } from "./directory-sync-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

function workspacePayload(role: string) {
  return { ok: true, workspace, role, memberCount: 2, settings: {} }
}

const plan = {
  toAdd: [{ email: "new@example.com", name: "New", role: "member" }],
  toUpdate: [
    {
      userId: "u-member",
      email: "member@example.com",
      from: { name: "Member", role: "member" },
      to: { name: "Member", role: "admin" },
    },
  ],
  toRemove: [{ userId: "u-old", email: "old@example.com" }],
  unchanged: 1,
  errors: ["Refusing to remove root@example.com: they are the last owner of this workspace."],
}

function syncResponse(dryRun: boolean) {
  return {
    ok: true,
    plan,
    result: {
      at: "2026-01-01T00:00:00.000Z",
      dryRun,
      applied: !dryRun,
      plan,
      outcome: dryRun ? null : { added: 1, updated: 1, removed: 1, failed: [] },
    },
  }
}

function stubFetch(role = "owner") {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/workspaces/ws-1") {
      return Promise.resolve(jsonResponse(workspacePayload(role)))
    }
    if (url === "/api/workspaces/ws-1/directory-sync") {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { dryRun?: boolean }
        return Promise.resolve(jsonResponse(syncResponse(body.dryRun === true)))
      }
      return Promise.resolve(jsonResponse({ ok: true, result: null }))
    }
    return Promise.resolve(jsonResponse({ ok: false, message: "not found" }, 404))
  })
}

const EXPORT = JSON.stringify([
  { email: "owner@example.com" },
  { email: "member@example.com", role: "admin" },
  { email: "new@example.com", name: "New" },
])

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  stubFetch()
})

describe("DirectorySyncScreen", () => {
  it("loads workspace role and renders the export form for an owner", async () => {
    render(<DirectorySyncScreen workspaceId="ws-1" />)

    expect(await screen.findByLabelText("Directory export (JSON)")).toBeEnabled()
    expect(screen.getByRole("checkbox", { name: "Remove absent members" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled()
    expect(screen.getByText("owner")).toBeInTheDocument()
  })

  it("renders read-only controls and a note for members", async () => {
    stubFetch("member")
    render(<DirectorySyncScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/Only workspace owners and admins/)).toBeInTheDocument()
    expect(screen.getByLabelText("Directory export (JSON)")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled()
  })

  it("previews a dry-run plan and shows adds/updates/removes/errors", async () => {
    const user = userEvent.setup()
    render(<DirectorySyncScreen workspaceId="ws-1" />)

    fireEvent.change(await screen.findByLabelText("Directory export (JSON)"), {
      target: { value: EXPORT },
    })
    await user.click(screen.getByRole("button", { name: "Preview" }))

    expect(
      await screen.findByText(/1 to add, 1 to update, 1 to remove, 1 unchanged/),
    ).toBeInTheDocument()
    expect(screen.getByText("new@example.com → member (New)")).toBeInTheDocument()
    expect(screen.getByText("member@example.com: member/Member → admin/Member")).toBeInTheDocument()
    expect(screen.getByText("old@example.com")).toBeInTheDocument()
    expect(screen.getAllByText(/last owner/).length).toBeGreaterThan(0)
    expect(screen.getByText("dry run")).toBeInTheDocument()

    const post = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("directory-sync") && init?.method === "POST",
    )
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      dryRun: true,
      removeAbsent: false,
    })
    // Apply unlocks only after a successful preview.
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled()
  })

  it("applies the plan and shows the outcome", async () => {
    const user = userEvent.setup()
    render(<DirectorySyncScreen workspaceId="ws-1" />)

    fireEvent.change(await screen.findByLabelText("Directory export (JSON)"), {
      target: { value: EXPORT },
    })
    await user.click(screen.getByRole("button", { name: "Preview" }))
    await user.click(await screen.findByRole("button", { name: "Apply" }))

    await waitFor(() => {
      expect(screen.getByText("Sync applied.")).toBeInTheDocument()
    })
    expect(screen.getAllByText(/1 added, 1 updated, 1 removed/).length).toBeGreaterThan(0)
    expect(screen.getAllByText("applied").length).toBeGreaterThan(0)
  })

  it("shows a client-side error for invalid JSON", async () => {
    render(<DirectorySyncScreen workspaceId="ws-1" />)

    fireEvent.change(await screen.findByLabelText("Directory export (JSON)"), {
      target: { value: "not json" },
    })
    expect(screen.getByRole("alert")).toHaveTextContent("not valid JSON")
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled()
  })
})
