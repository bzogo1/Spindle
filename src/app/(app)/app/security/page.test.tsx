import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import SecurityPage from "./page"

/**
 * Smoke test for the security center page: honest subtitle copy, the link
 * card to the policies sub-page, and all panel mounts. Child panels fetch on
 * mount — a single catch-all mock covers every endpoint.
 */
function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        alerts: [],
        unreadCount: 0,
        preferences: { inAppNotifications: true, emailNotifications: true },
        totpEnabled: false,
        devices: [],
        currentDevice: { trusted: false, deviceId: null },
      }),
    ),
  )
})

describe("SecurityPage", () => {
  it("renders the subtitle, policies link card, and all panels", async () => {
    render(<SecurityPage />)

    expect(screen.getByRole("heading", { name: "Security", level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/configure your sign-in security policies/)).toBeInTheDocument()

    const link = screen.getByRole("link", { name: /Manage policies/ })
    expect(link).toHaveAttribute("href", "/app/security/policies")
    expect(screen.getByText(/Enforcement on the sign-in routes is planned/)).toBeInTheDocument()

    // All three panels still mount.
    await screen.findByRole("heading", { name: "Security alerts" })
    await screen.findByRole("heading", { name: "Two-factor devices" })
    await screen.findByRole("heading", { name: "Security keys" })
  })
})
