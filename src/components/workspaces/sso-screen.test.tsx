import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SsoScreen } from "./sso-screen"

const config = {
  enabled: false,
  provider: "none" as const,
  entityId: "",
  ssoUrl: "",
  certificateConfigured: false,
  certificateFingerprintLast4: "",
  enforced: false,
  allowedDomains: [] as string[],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const fetchMock = vi.fn()

function payload(overrides: Record<string, unknown> = {}) {
  return { ok: true, role: "owner", config, ...overrides }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("SsoScreen", () => {
  it("loads config and renders editable fields for an owner", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<SsoScreen workspaceId="ws-1" />)

    expect(await screen.findByLabelText("Identity provider protocol")).toHaveValue("none")
    expect(screen.getByLabelText("Entity ID / issuer")).toBeInTheDocument()
    expect(screen.getByLabelText("SSO URL")).toBeInTheDocument()
    expect(screen.getByLabelText("Allowed email domains")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Enable SSO" })).toBeEnabled()
    expect(screen.getByRole("switch", { name: "Enforce SSO for members" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/ws-1/sso",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("shows the config-only notice and enforcement warning copy", async () => {
    fetchMock.mockResolvedValue(jsonResponse(payload()))

    render(<SsoScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/not yet implemented/i)).toBeInTheDocument()
    expect(screen.getByText(/never stored here/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("switch", { name: "Enforce SSO for members" }))
    expect(screen.getByRole("alert")).toHaveTextContent(/enforcing SSO will require/i)
  })

  it("shows an insufficient-permissions state for members (403)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, code: "forbidden", message: "Insufficient workspace permissions." },
        403,
      ),
    )

    render(<SsoScreen workspaceId="ws-1" />)

    expect(await screen.findByText(/Only workspace owners and admins/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Identity provider protocol")).not.toBeInTheDocument()
  })

  it("sends only changed fields in the PATCH body", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/workspaces/ws-1/sso" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(payload()))
      }
      if (url === "/api/workspaces/ws-1/sso" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse(
            payload({
              config: {
                ...config,
                enabled: true,
                provider: "oidc",
                entityId: "https://idp.example.com/***",
                ssoUrl: "https://idp.example.com/***",
                allowedDomains: ["example.com"],
              },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
    })

    render(<SsoScreen workspaceId="ws-1" />)

    await userEvent.click(await screen.findByRole("switch", { name: "Enable SSO" }))
    await userEvent.selectOptions(screen.getByLabelText("Identity provider protocol"), "oidc")
    await userEvent.type(screen.getByLabelText("Entity ID / issuer"), "https://idp.example.com")
    await userEvent.type(screen.getByLabelText("SSO URL"), "https://idp.example.com/sso")
    await userEvent.type(screen.getByLabelText("Allowed email domains"), "example.com")

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/sso",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            enabled: true,
            provider: "oidc",
            entityId: "https://idp.example.com",
            ssoUrl: "https://idp.example.com/sso",
            allowedDomains: ["example.com"],
          }),
        }),
      ),
    )
    // After save the screen reloads (masked config) and shows the saved note.
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()
  })

  it("shows an error state with retry when loading fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Boom" }, 500))

    render(<SsoScreen workspaceId="ws-1" />)

    expect(await screen.findByText("Boom")).toBeInTheDocument()
    fetchMock.mockResolvedValue(jsonResponse(payload()))
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByLabelText("Identity provider protocol")).toBeInTheDocument()
  })
})
