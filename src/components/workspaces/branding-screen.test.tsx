import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { BrandingScreen } from "./branding-screen"

const branding = {
  displayName: "Acme Labs",
  logoText: "Acme",
  logoUrl: "https://cdn.example.com/logo.png",
  accentColor: "#112233",
  backgroundColor: "",
  workspaceSlug: "acme",
  workspaceName: "Acme Inc",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

function payload(overrides: Record<string, unknown> = {}) {
  return { ok: true, role: "owner", branding, ...overrides }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("BrandingScreen", () => {
  it("loads branding and renders editable fields for an owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<BrandingScreen workspaceId="ws-1" />)

    expect(await screen.findByLabelText("Display name")).toHaveValue("Acme Labs")
    expect(screen.getByLabelText("Logo text")).toHaveValue("Acme")
    expect(screen.getByLabelText("Logo image URL")).toHaveValue("https://cdn.example.com/logo.png")
    expect(screen.getByLabelText("Accent color")).toHaveValue("#112233")
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/branding",
      expect.objectContaining({ cache: "no-store" }),
    )
    // Live preview shows the branded name.
    expect(screen.getByLabelText("Branding preview")).toHaveTextContent("Acme")
  })

  it("shows an insufficient-permissions state for members (403)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, code: "forbidden", message: "Insufficient workspace permissions." },
        403,
      ),
    )

    render(<BrandingScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/Only workspace owners and admins/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument()
  })

  it("handles a workspace with no branding configured yet", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload({ branding: null })))

    render(<BrandingScreen workspaceId="ws-1" />)

    expect(await screen.findByLabelText("Display name")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  })

  it("sends only changed fields in the PATCH body", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ ok: true, role: "owner", branding }))
      }
      expect(url).toBe("/api/workspaces/ws-1/branding")
      return Promise.resolve(jsonResponse(payload()))
    })

    render(<BrandingScreen workspaceId="ws-1" />)

    const displayName = await screen.findByLabelText("Display name")
    await userEvent.clear(displayName)
    await userEvent.type(displayName, "Acme Research")

    const save = screen.getByRole("button", { name: "Save changes" })
    await waitFor(() => expect(save).toBeEnabled())
    await userEvent.click(save)

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      )
      expect(patchCall).toBeDefined()
      const body = JSON.parse(String((patchCall![1] as RequestInit).body))
      expect(body).toEqual({ displayName: "Acme Research" })
    })
  })

  it("reset restores the baseline draft", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<BrandingScreen workspaceId="ws-1" />)

    const displayName = await screen.findByLabelText("Display name")
    await userEvent.clear(displayName)
    await userEvent.type(displayName, "Changed")

    const reset = screen.getByRole("button", { name: "Reset" })
    await waitFor(() => expect(reset).toBeEnabled())
    await userEvent.click(reset)

    expect(displayName).toHaveValue("Acme Labs")
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  })
})
