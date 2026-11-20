import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"
import { ResetPasswordForm } from "./reset-password-form"

const fetchMock = vi.mocked(globalThis.fetch)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** Low-difficulty challenge so the widget solves almost instantly in tests. */
const CAPTCHA_CHALLENGE = {
  ok: true,
  challengeId: "0123456789abcdef",
  prefix: "spindle-pow:0123456789abcdef:testsalt:",
  difficulty: 4,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
}

/** Captcha endpoints succeed; `handler` covers the reset-confirm POST. */
function routeFetch(handler?: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url === "/api/auth/captcha" && method === "GET") return jsonResponse(CAPTCHA_CHALLENGE)
    if (url === "/api/auth/captcha/verify" && method === "POST") {
      return jsonResponse({ ok: true, token: "captcha-token-123" })
    }
    if (handler) return handler()
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })
}

async function waitForCaptcha() {
  await screen.findByText("Security check passed.", {}, { timeout: 5000 })
}

describe("ResetPasswordForm", () => {
  it("shows a clear next step for an expired token", () => {
    render(
      <LanguageProvider>
        <ResetPasswordForm token="expired-token" />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "This reset link has expired" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/reset-password",
    )
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "/about#contact",
    )
  })

  it("rejects used and invalid tokens with different copy", () => {
    const { rerender } = render(
      <LanguageProvider>
        <ResetPasswordForm token="used-token" />
      </LanguageProvider>,
    )
    expect(
      screen.getByRole("heading", { name: "This reset link has already been used" }),
    ).toBeInTheDocument()

    rerender(
      <LanguageProvider>
        <ResetPasswordForm token="bad-token" />
      </LanguageProvider>,
    )
    expect(screen.getByRole("heading", { name: "This reset link isn't valid" })).toBeInTheDocument()
  })

  it("catches a confirm-password mismatch on the client", async () => {
    routeFetch()
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <ResetPasswordForm token="demo-token" />
      </LanguageProvider>,
    )
    await waitForCaptcha()

    await user.type(screen.getByLabelText("New password"), "correct horse")
    await user.type(screen.getByLabelText("Confirm new password"), "correct horsey")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(screen.getByRole("alert")).toHaveTextContent("Passwords don't match.")
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-invalid", "true")
  })

  it("toggles password visibility without disabling paste", async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <ResetPasswordForm token="demo-token" />
      </LanguageProvider>,
    )

    const password = screen.getByLabelText("New password")
    expect(password).toHaveAttribute("type", "password")

    await user.click(screen.getByRole("button", { name: "Show new password" }))
    expect(password).toHaveAttribute("type", "text")
    expect(screen.getByRole("button", { name: "Hide new password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("shows the success state and sign-in CTA for a valid token", async () => {
    routeFetch(() => jsonResponse({ ok: true, reset: true }))
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <ResetPasswordForm token="demo-token" />
      </LanguageProvider>,
    )
    await waitForCaptcha()

    await user.type(screen.getByLabelText("New password"), "correct horse")
    await user.type(screen.getByLabelText("Confirm new password"), "correct horse")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(
      await screen.findByRole("heading", { name: "Password updated" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/")
  })

  it("re-solves the captcha when the server rejects the token", async () => {
    let confirmCalls = 0
    routeFetch(() => {
      confirmCalls += 1
      return jsonResponse(
        { ok: false, code: "captcha_failed", message: "Security check failed. Please try again." },
        403,
      )
    })
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <ResetPasswordForm token="demo-token" />
      </LanguageProvider>,
    )
    await waitForCaptcha()

    await user.type(screen.getByLabelText("New password"), "correct horse")
    await user.type(screen.getByLabelText("Confirm new password"), "correct horse")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    // The 403 surfaces the server message and remounts the widget, which
    // fetches a fresh challenge — tokens are single-use.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Security check failed. Please try again.",
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input) === "/api/auth/captcha" && (init?.method ?? "GET") === "GET",
        ).length,
      ).toBeGreaterThanOrEqual(2),
    )
    await waitForCaptcha()
    expect(confirmCalls).toBe(1)
  }, 10000)
})
