import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const search = vi.hoisted(() => ({ value: "" }))
const router = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => router,
}))

import { AccountRecoveryScreen } from "./account-recovery-screen"
import { LanguageProvider } from "@/components/i18n/language-provider"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderScreen() {
  return render(
    <LanguageProvider>
      <AccountRecoveryScreen />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  search.value = ""
  router.replace.mockReset()
  window.sessionStorage.clear()
})

describe("AccountRecoveryScreen", () => {
  it("shows the request form when no token is present", () => {
    renderScreen()
    expect(screen.getByRole("heading", { name: "Recover your account" })).toBeInTheDocument()
    expect(screen.getByLabelText("Work email")).toBeInTheDocument()
  })

  it("sends a recovery email and shows the sent state", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ ok: true, sent: true }))
    renderScreen()

    await user.type(screen.getByLabelText("Work email"), "ada@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send recovery link" }))

    expect(await screen.findByRole("heading", { name: "Check your inbox" })).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/recovery/request",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("verifies a live token and renders the guided steps", async () => {
    search.value = "token=abc123"
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          sessionToken: "sess",
          sessionExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          email: "ada@lab.edu",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          phase: "verified",
          email: "ada@lab.edu",
          sessionExpiresAt: null,
          actions: { passwordResetAt: null, emailVerifiedAt: null },
          events: [],
        }),
      )

    renderScreen()

    expect(await screen.findByRole("heading", { name: "Secure your account" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Set a new password" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Review security activity" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Finish recovery" })).toBeInTheDocument()
  })

  it("shows an expired-link state with a way to request a new link", async () => {
    search.value = "token=dead"
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(
        { ok: false, code: "invalid_token", message: "expired", reason: "expired" },
        401,
      ),
    )

    const user = userEvent.setup()
    renderScreen()

    expect(
      await screen.findByRole("heading", { name: "This recovery link has expired" }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Request a new link" }))
    expect(router.replace).toHaveBeenCalledWith("/account-recovery")
    expect(screen.getByRole("heading", { name: "Recover your account" })).toBeInTheDocument()
  })

  it("shows an invalid-link state for a malformed token", async () => {
    search.value = "token=bad-token"
    // getTokenState classifies bad-token locally, but the server still runs;
    // a network failure maps to the invalid state.
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("offline"))

    renderScreen()

    expect(
      await screen.findByRole("heading", { name: "This recovery link isn't valid" }),
    ).toBeInTheDocument()
  })
})
