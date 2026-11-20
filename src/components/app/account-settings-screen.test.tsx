import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { Toaster } from "@/components/ui/toast"
import type { MockSessionData } from "@/lib/auth/mock-session"

import { AccountSettingsScreen } from "./account-settings-screen"

const session: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function renderScreen({ toasts = false }: { toasts?: boolean } = {}) {
  return render(
    <MockSessionProvider initialSession={session}>
      <AccountSettingsScreen />
      {toasts ? <Toaster /> : null}
    </MockSessionProvider>,
  )
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const BACKUP_CODES_ENABLED = { ok: true, enabled: true, managed: false, remaining: null }
const BACKUP_CODES_DISABLED = { ok: true, enabled: false, managed: false, remaining: null }

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * fetch mock that returns a FRESH Response per call (a shared Response body
 * can only be read once) and routes the backup-codes status GET to a healthy
 * payload so the mounted panel stays out of its error state.
 */
const EMAIL_CHANGE_IDLE = {
  ok: true,
  emailChange: {
    email: "bogdan@example.com",
    pending: null,
    resendCooldownSeconds: 0,
  },
}

function mockApiFetch(handler: (url: string) => Response, backupStatus = BACKUP_CODES_ENABLED) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = requestUrl(input)
    if (url.includes("/api/auth/email-change")) {
      return Promise.resolve(jsonResponse(EMAIL_CHANGE_IDLE))
    }
    return Promise.resolve(
      url.includes("/api/auth/2fa/backup-codes") ? jsonResponse(backupStatus) : handler(url),
    )
  })
}

function backupCodeCalls() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => requestUrl(input).includes("/api/auth/2fa/backup-codes"))
}

beforeEach(() => {
  // Default: the account has 2FA disabled, matching the pre-wiring UI.
  mockApiFetch(() => jsonResponse({ ok: true }), BACKUP_CODES_DISABLED)
})

function mockProfilePut(name = "Bogdan Zogovic") {
  mockApiFetch(
    () => jsonResponse({ ok: true, profile: { name, email: "bogdan@example.com" } }),
    BACKUP_CODES_DISABLED,
  )
}

describe("AccountSettingsScreen", () => {
  it("renders profile, preferences, security, sessions, and export sections", async () => {
    renderScreen()

    expect(await screen.findByRole("heading", { name: "Account settings" })).toBeInTheDocument()
    expect(screen.getByLabelText("Display name")).toHaveValue("Bogdan Zogovic")
    // The email field is now the EmailChangePanel (current email + change UI).
    expect(await screen.findByText(/Current email:/)).toHaveTextContent("bogdan@example.com")
    expect(screen.getByLabelText("New email address")).toBeInTheDocument()
    expect(screen.getByLabelText("Theme")).toBeInTheDocument()
    expect(screen.getByLabelText("Timezone")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Product updates" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Weekly digest" })).not.toBeChecked()

    expect(screen.getByRole("heading", { name: "Password" })).toBeInTheDocument()
    expect(screen.getByLabelText("Current password")).toBeInTheDocument()
    expect(screen.getByLabelText("New password")).toBeInTheDocument()
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Two-factor authentication" })).toBeInTheDocument()
    expect(screen.getByText("Off")).toBeInTheDocument()
    // 2FA is disabled for this account, so the backup-codes panel stays hidden.
    // Wait for the status query to settle: only the screen's GET fires (the
    // panel would issue a second one if it mounted).
    await waitFor(() => expect(backupCodeCalls()).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(backupCodeCalls()).toHaveLength(1)
    expect(screen.queryByText("Backup codes")).not.toBeInTheDocument()
    // 2FA disabled → the lost-device recovery panels stay hidden too.
    expect(screen.queryByText("Lost your authenticator?")).not.toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument()
    // Session management moved to the dedicated /app/sessions screen — this
    // card only links there (no fabricated session list).
    const manageSessions = screen.getByRole("link", { name: /manage sessions/i })
    expect(manageSessions).toHaveAttribute("href", "/app/sessions")

    expect(screen.getByRole("heading", { name: "Data export" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /request data export/i })).toBeInTheDocument()
  })

  it("renders the avatar upload control in the profile card", async () => {
    renderScreen()

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument()
    expect(screen.getByText("Avatar")).toBeInTheDocument()
    // The file input is labelled by the "Avatar" field label.
    expect(screen.getByLabelText("Avatar")).toHaveAttribute("type", "file")
    expect(await screen.findByText(/PNG, JPG, WebP, or GIF up to 2 MB/)).toBeInTheDocument()
  })

  it("shows the backup codes panel and On badge when 2FA is enabled", async () => {
    mockApiFetch(() => jsonResponse({ ok: true }), BACKUP_CODES_ENABLED)
    renderScreen()

    expect(await screen.findByText("Backup codes")).toBeInTheDocument()
    expect(screen.getByText("On")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disable two-factor" })).toBeInTheDocument()
    // The panel loaded its own status and offers to manage codes.
    expect(await screen.findByRole("button", { name: "Generate backup codes" })).toBeInTheDocument()
    // Lost-device recovery UI mounts alongside: request panel + status panel.
    expect(screen.getByText("Lost your authenticator?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Email me a recovery link" })).toBeInTheDocument()
  })

  it("shows an in-progress recovery cooldown in the security card", async () => {
    mockApiFetch(
      (url) =>
        url.includes("/api/auth/2fa/recovery/status")
          ? jsonResponse({
              ok: true,
              state: "cooldown",
              executeAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
              secondsRemaining: 48 * 3600,
            })
          : jsonResponse({ ok: true }),
      BACKUP_CODES_ENABLED,
    )
    renderScreen()

    expect(await screen.findByText(/Recovery confirmed/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel recovery" })).toBeInTheDocument()
  })

  it("emails a recovery link from the security card", async () => {
    const user = userEvent.setup()
    mockApiFetch(
      (url) =>
        url.includes("/api/auth/2fa/recovery/request")
          ? jsonResponse({ ok: true, state: "awaiting_token", emailSent: true })
          : jsonResponse({ ok: true }),
      BACKUP_CODES_ENABLED,
    )
    renderScreen()

    await user.click(await screen.findByRole("button", { name: "Email me a recovery link" }))

    expect(await screen.findByText(/single-use recovery link/)).toBeInTheDocument()
    const postCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([input, init]) =>
          requestUrl(input).includes("/api/auth/2fa/recovery/request") && init?.method === "POST",
      )
    expect(postCall).toBeDefined()
  })

  it("shows a saved confirmation after saving the profile", async () => {
    const user = userEvent.setup()
    mockProfilePut()
    renderScreen()

    await user.click(await screen.findByRole("button", { name: "Save profile" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Changes saved.")

    const putCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PUT")
    expect(putCall?.[0]).toBe("/api/profile")
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ name: "Bogdan Zogovic" })
  })

  it("surfaces an error when the profile save fails", async () => {
    const user = userEvent.setup()
    mockApiFetch(() => jsonResponse({ ok: false, code: "server_error", message: "nope" }, 500))
    renderScreen({ toasts: true })

    await user.click(await screen.findByRole("button", { name: "Save profile" }))

    expect(await screen.findByText("Couldn't save profile")).toBeInTheDocument()
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
  })

  it("requires a display name", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.clear(await screen.findByLabelText("Display name"))
    await user.click(screen.getByRole("button", { name: "Save profile" }))

    expect(screen.getByRole("alert")).toHaveTextContent("Display name is required.")
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
  })

  it("validates the password form before submitting", async () => {
    const user = userEvent.setup()
    renderScreen()

    await screen.findByRole("heading", { name: "Password" })
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining(["Enter your current password.", "Use at least 8 characters."]),
    )

    await user.type(screen.getByLabelText("Current password"), "old-password")
    await user.type(screen.getByLabelText("New password"), "short")
    await user.type(screen.getByLabelText("Confirm new password"), "different")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    const alerts = screen.getAllByRole("alert")
    expect(alerts.map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining(["Use at least 8 characters.", "Passwords do not match."]),
    )
  })

  it("accepts a valid password change and confirms with a toast", async () => {
    const user = userEvent.setup()
    renderScreen({ toasts: true })

    await screen.findByRole("heading", { name: "Password" })
    await user.type(screen.getByLabelText("Current password"), "old-password")
    await user.type(screen.getByLabelText("New password"), "N3w!SecurePass")
    await user.type(screen.getByLabelText("Confirm new password"), "N3w!SecurePass")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(await screen.findByText("Password updated", {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByLabelText("New password")).toHaveValue("")
  }, 10000)

  it("enables two-factor authentication through the setup dialog", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole("button", { name: "Enable two-factor" }))

    const dialog = await screen.findByRole("dialog")
    const confirm = within(dialog).getByRole("button", { name: "Enable two-factor" })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText("Verification code"), "123456")
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(await screen.findByText("On")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disable two-factor" })).toBeInTheDocument()
  })

  it("links to the real sessions screen instead of listing mock sessions", async () => {
    renderScreen()

    const manageSessions = await screen.findByRole("link", { name: /manage sessions/i })
    expect(manageSessions).toHaveAttribute("href", "/app/sessions")
    // The old fabricated session list and its local revoke buttons are gone.
    expect(screen.queryByText("MacBook Pro")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Sign out other sessions" }),
    ).not.toBeInTheDocument()
  })

  it("requests a data export and offers a download", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-export")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })

    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole("button", { name: /request data export/i }))

    const download = await screen.findByRole(
      "link",
      { name: /download export/i },
      { timeout: 3000 },
    )
    expect(download).toHaveAttribute("download", "spindle-account-export.json")
    expect(screen.getByText(/export ready/i)).toBeInTheDocument()
  }, 10000)

  it("shows the loading skeleton while mock state is loading", async () => {
    window.history.replaceState(null, "", "/?mock=loading")
    renderScreen()

    expect(await screen.findByText("Loading account settings")).toBeInTheDocument()
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument()
  })

  it("shows an error state with retry while mock state is error", async () => {
    window.history.replaceState(null, "", "/?mock=error")
    renderScreen()

    expect(await screen.findByText("Account settings did not load")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
  })
})
