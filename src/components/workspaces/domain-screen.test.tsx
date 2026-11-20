import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceDomainScreen } from "./domain-screen"

const pendingDomain = {
  domain: "app.example.com",
  status: "pending" as const,
  verifiedAt: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  verificationToken: "tok_secret_123",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

function payload(overrides: Record<string, unknown> = {}) {
  return { ok: true, role: "owner", domain: null, ...overrides }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("WorkspaceDomainScreen", () => {
  it("shows the empty state and an add-domain form for an owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<WorkspaceDomainScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/No custom domain is configured/)).toBeInTheDocument()
    expect(screen.getByLabelText("Domain")).toBeEnabled()
    expect(screen.getByRole("button", { name: /add domain/i })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/domain",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("saves a new domain via PUT", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/domain" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload()))
      }
      if (url === "/api/workspaces/ws-1/domain" && init?.method === "PUT") {
        return Promise.resolve(jsonResponse(payload({ domain: pendingDomain })))
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspaceDomainScreen workspaceId="ws-1" />)

    await userEvent.type(await screen.findByLabelText("Domain"), "app.example.com")
    await userEvent.click(screen.getByRole("button", { name: /add domain/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/domain",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ domain: "app.example.com" }),
        }),
      ),
    )
    expect((await screen.findAllByText("app.example.com")).length).toBeGreaterThan(0)
    expect(screen.getByText(/spindle-verify=tok_secret_123/)).toBeInTheDocument()
  })

  it("shows DNS TXT instructions and verifies a pending domain", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/domain" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload({ domain: pendingDomain })))
      }
      if (url === "/api/workspaces/ws-1/domain" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(
            payload({
              domain: {
                ...pendingDomain,
                status: "verified",
                verifiedAt: "2026-02-02T00:00:00.000Z",
              },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspaceDomainScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Pending verification")).toBeInTheDocument()
    expect(screen.getByText(/spindle-verify=tok_secret_123/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Verification token"), "tok_secret_123")
    await userEvent.click(screen.getByRole("button", { name: /verify domain/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/domain",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "verify", token: "tok_secret_123" }),
        }),
      ),
    )
    expect(await screen.findByText("Verified")).toBeInTheDocument()
    // Verified domains no longer show the TXT/verify controls.
    expect(screen.queryByLabelText("Verification token")).not.toBeInTheDocument()
  })

  it("removes the domain after a two-step confirm", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/domain" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload({ domain: pendingDomain })))
      }
      if (url === "/api/workspaces/ws-1/domain" && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ok: true, removed: true }))
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<WorkspaceDomainScreen workspaceId="ws-1" />)

    expect((await screen.findAllByText("app.example.com")).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole("button", { name: "Remove domain" }))
    // First click only arms the confirm — no DELETE yet.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/workspaces/ws-1/domain",
      expect.objectContaining({ method: "DELETE" }),
    )
    expect(screen.getByText(/releases the hostname/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/domain",
        expect.objectContaining({ method: "DELETE" }),
      ),
    )
    expect(await screen.findByText(/No custom domain is configured/)).toBeInTheDocument()
  })

  it("renders read-only controls and hides the token for members", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        role: "member",
        domain: { ...pendingDomain, verificationToken: undefined },
      }),
    )

    render(<WorkspaceDomainScreen workspaceId="ws-1" />)

    expect((await screen.findAllByText("app.example.com")).length).toBeGreaterThan(0)
    expect(screen.getByText(/read-only/)).toBeInTheDocument()
    expect(screen.getByLabelText("Domain")).toBeDisabled()
    expect(screen.queryByLabelText("Verification token")).not.toBeInTheDocument()
    expect(screen.queryByText(/spindle-verify=/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /remove domain/i })).not.toBeInTheDocument()
  })

  it("shows an error state with retry when loading fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Boom" }, 500))

    render(<WorkspaceDomainScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Boom")).toBeInTheDocument()
    fetchMock.mockResolvedValue(jsonResponse(payload()))
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByText(/No custom domain is configured/)).toBeInTheDocument()
  })
})
