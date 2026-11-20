import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AccountRecoverySteps } from "./account-recovery-steps"
import { LanguageProvider } from "@/components/i18n/language-provider"
import type { RecoverySession } from "@/lib/auth-recovery"

const session: RecoverySession = {
  sessionToken: "sess-token",
  sessionExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  email: "ada@lab.edu",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function statusPayload(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    ok: true,
    phase: "verified",
    email: session.email,
    sessionExpiresAt: session.sessionExpiresAt,
    actions: { passwordResetAt: null, emailVerifiedAt: null },
    events: [
      { timestamp: "2030-01-01T00:00:00.000Z", type: "signin.success" },
      { timestamp: "2030-01-02T00:00:00.000Z", type: "password.reset" },
    ],
    ...overrides,
  })
}

function renderSteps(onExpired = vi.fn(), onDone = vi.fn()) {
  render(
    <LanguageProvider>
      <AccountRecoverySteps session={session} onExpired={onExpired} onDone={onDone} />
    </LanguageProvider>,
  )
  return { onExpired, onDone }
}

beforeEach(() => {
  vi.mocked(globalThis.fetch).mockReset()
})

describe("AccountRecoverySteps", () => {
  it("loads status and lists recent security events", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(statusPayload())
    renderSteps()

    expect(
      await screen.findByRole("heading", { name: "Recent security activity" }),
    ).toBeInTheDocument()
    expect(screen.getByText("signin success")).toBeInTheDocument()
    expect(screen.getByText("password reset")).toBeInTheDocument()
  })

  it("resets the password through the recovery session", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(statusPayload())
      .mockResolvedValueOnce(jsonResponse({ ok: true, reset: true }))

    renderSteps()
    await screen.findByText("signin success")

    await user.type(screen.getByLabelText("New password"), "new-password-1")
    await user.type(screen.getByLabelText("Confirm new password"), "new-password-1")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    await screen.findByText("Password updated")
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[1]
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionToken: "sess-token",
      password: "new-password-1",
    })
  })

  it("rejects a client-side password mismatch", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(statusPayload())
    renderSteps()
    await screen.findByText("signin success")

    await user.type(screen.getByLabelText("New password"), "new-password-1")
    await user.type(screen.getByLabelText("Confirm new password"), "different-1")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match")
    // Only the status call happened — no password POST.
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
  })

  it("marks the email verified", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(statusPayload())
      .mockResolvedValueOnce(jsonResponse({ ok: true, verified: true }))

    renderSteps()
    await screen.findByText("signin success")
    await user.click(screen.getByRole("button", { name: "Mark email as verified" }))

    expect(await screen.findByText("Email verified")).toBeInTheDocument()
  })

  it("completes the recovery and notifies the parent", async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(statusPayload())
      .mockResolvedValueOnce(jsonResponse({ ok: true, completed: true }))
    const { onDone } = renderSteps()

    await user.click(await screen.findByRole("button", { name: "Finish recovery" }))

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[1]
    expect(JSON.parse(String(init?.body))).toEqual({ sessionToken: "sess-token" })
  })

  it("calls onExpired when the session token is rejected", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, code: "invalid_token", message: "expired" }, 401),
    )
    const { onExpired } = renderSteps()

    await vi.waitFor(() => expect(onExpired).toHaveBeenCalled())
  })

  it("hydrates completed steps from the server status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      statusPayload({
        actions: {
          passwordResetAt: "2030-01-01T00:00:00.000Z",
          emailVerifiedAt: "2030-01-01T00:00:00.000Z",
        },
      }),
    )
    renderSteps()

    expect(await screen.findByText("Password updated")).toBeInTheDocument()
    expect(screen.getByText("Email verified")).toBeInTheDocument()
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()
  })
})
