import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"

import EmergencyAccessPage from "./page"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderPage() {
  return render(
    <LanguageProvider>
      <EmergencyAccessPage />
    </LanguageProvider>,
  )
}

const REDEEM_OK = {
  ok: true,
  accessToken: "access-token-1",
  accessExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  email: "ada@lab.edu",
  passwordResetRequired: true,
}

beforeEach(() => {
  vi.mocked(globalThis.fetch).mockReset()
})

describe("EmergencyAccessPage", () => {
  it("renders the redeem form", () => {
    renderPage()
    expect(
      screen.getByRole("heading", { name: "Recover with an emergency code" }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Account email")).toBeInTheDocument()
    expect(screen.getByLabelText("Emergency code")).toBeInTheDocument()
  })

  it("shows the server error for a rejected code", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          ok: false,
          code: "invalid_code",
          message: "That emergency code is invalid, expired, or already used.",
        },
        401,
      ),
    )
    renderPage()

    await user.type(screen.getByLabelText("Account email"), "ada@lab.edu")
    await user.type(screen.getByLabelText("Emergency code"), "XXXX-XXXX")
    await user.click(screen.getByRole("button", { name: "Use emergency code" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid, expired, or already used/)
  })

  it("walks the full restricted recovery: redeem → password → finish", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse(REDEEM_OK))
      .mockResolvedValueOnce(jsonResponse({ ok: true, updated: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, verified: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, completed: true }))

    renderPage()

    await user.type(screen.getByLabelText("Account email"), "ada@lab.edu")
    await user.type(screen.getByLabelText("Emergency code"), "ABCD-1234")
    await user.click(screen.getByRole("button", { name: "Use emergency code" }))

    // Secure phase: finish is gated on the mandatory password step.
    expect(await screen.findByRole("heading", { name: "Secure your account" })).toBeInTheDocument()
    const finish = screen.getByRole("button", { name: "Finish recovery" })
    expect(finish).toBeDisabled()

    await user.type(screen.getByLabelText("New password"), "new-secret-1")
    await user.type(screen.getByLabelText("Confirm new password"), "new-secret-1")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(await screen.findByText("Password updated.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Confirm my email" }))
    expect(await screen.findByText("Email confirmed.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Finish recovery" }))
    expect(await screen.findByRole("heading", { name: "Account secured" })).toBeInTheDocument()

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input))
    expect(urls).toEqual([
      "/api/auth/emergency-codes/redeem",
      "/api/auth/emergency-codes/access/password",
      "/api/auth/emergency-codes/access/email-verified",
      "/api/auth/emergency-codes/access/complete",
    ])
    // The access token travels in request bodies only — never the URL.
    // (The first call is the redeem request, which carries the code instead.)
    for (const [input, init] of vi.mocked(globalThis.fetch).mock.calls.slice(1)) {
      expect(String(input)).not.toContain("access-token-1")
      expect(String(init?.body)).toContain("access-token-1")
    }
  })
})
