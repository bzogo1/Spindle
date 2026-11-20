import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ClientSession } from "@/lib/auth/auth-client"
import { LanguageProvider } from "@/components/i18n/language-provider"
import { CreateWorkspaceForm } from "./create-workspace-form"

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

/**
 * Routes fetch calls: captcha endpoints get a fast solvable challenge, every
 * other request goes to `handler` (the per-test signup response).
 */
function routeFetch(handler: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url === "/api/auth/captcha" && method === "GET") return jsonResponse(CAPTCHA_CHALLENGE)
    if (url === "/api/auth/captcha/verify" && method === "POST") {
      return jsonResponse({ ok: true, token: "captcha-token-123" })
    }
    return handler()
  })
}

/** Waits until the captcha widget has minted its token. */
async function waitForCaptcha() {
  await screen.findByText("Security check passed.", {}, { timeout: 5000 })
}

function signupCallCount() {
  return fetchMock.mock.calls.filter(([input]) => String(input) === "/api/auth/signup").length
}

const clientSession: ClientSession = {
  user: { id: "u1", email: "researcher@lab.edu", name: "Researcher", emailVerified: true },
  workspace: { name: "coastal-resilience", slug: "coastal-resilience" },
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

const VALID_PASSWORD = "correct horse1"

function renderForm() {
  const onSuccess = vi.fn()
  render(
    <LanguageProvider>
      <CreateWorkspaceForm onSuccess={onSuccess} />
    </LanguageProvider>,
  )
  return { onSuccess }
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Workspace name"), "coastal-resilience")
  await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
  await user.type(screen.getByLabelText("Password", { exact: true }), VALID_PASSWORD)
  await user.type(screen.getByLabelText("Confirm password"), VALID_PASSWORD)
  await user.click(screen.getByRole("checkbox", { name: /Terms of Service/ }))
}

afterEach(() => {
  fetchMock.mockReset()
})

describe("CreateWorkspaceForm", () => {
  it("focuses the workspace name first when everything is invalid", async () => {
    const user = userEvent.setup()
    routeFetch(() => jsonResponse({ ok: true }))
    renderForm()
    await waitForCaptcha()

    await user.click(screen.getByRole("button", { name: "Create free workspace" }))

    expect(await screen.findByText("Name your workspace.")).toBeInTheDocument()
    expect(screen.getByLabelText("Workspace name")).toHaveFocus()
  })

  it("creates the workspace through the real API and reports the session", async () => {
    const user = userEvent.setup()
    routeFetch(() => jsonResponse({ ok: true, session: clientSession }))
    const { onSuccess } = renderForm()
    await waitForCaptcha()

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create free workspace" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess.mock.calls[0][0].workspace.name).toBe("coastal-resilience")
    expect(onSuccess.mock.calls[0][1]).toEqual(clientSession)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/signup",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceName: "coastal-resilience",
          email: "researcher@lab.edu",
          password: VALID_PASSWORD,
          remember: true,
          captchaToken: "captcha-token-123",
        }),
      }),
    )
  }, 10000)

  it("falls back to the mock sign-up when the API is unreachable", async () => {
    const user = userEvent.setup()
    // Captcha succeeds (submit requires a verified token) but the signup
    // endpoint is unreachable, exercising the mock fallback.
    routeFetch(() => Promise.reject(new Error("connection refused")))
    const { onSuccess } = renderForm()
    await waitForCaptcha()

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create free workspace" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(onSuccess.mock.calls[0][0].workspace.name).toBe("coastal-resilience")
    expect(onSuccess.mock.calls[0][1]).toBeNull()
  }, 5000)

  it("maps a reachable-server email_taken error to the sign-in hint", async () => {
    const user = userEvent.setup()
    routeFetch(() =>
      jsonResponse({ ok: false, code: "email_taken", message: "Email already registered." }, 409),
    )
    renderForm()
    await waitForCaptcha()

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create free workspace" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account already exists for this email. Try signing in instead, or use a different email.",
    )
  }, 10000)

  it("shows the generic error for non-MockAuthError failures", async () => {
    const user = userEvent.setup()
    routeFetch(() => jsonResponse({ ok: false, code: "rate_limited", message: "Slow down." }, 429))
    renderForm()
    await waitForCaptcha()

    await fillValidForm(user)
    await user.click(screen.getByRole("button", { name: "Create free workspace" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Check your connection and try again.",
    )
  }, 10000)

  it("ignores a second submit while the first is in flight", async () => {
    let resolveFetch!: (response: Response) => void
    routeFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const { onSuccess } = renderForm()
    await waitForCaptcha()

    await fillValidForm(userEvent.setup())

    const form = screen.getByRole("form", { name: "Create workspace" })
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(signupCallCount()).toBe(1))

    resolveFetch(jsonResponse({ ok: true, session: clientSession }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(signupCallCount()).toBe(1)
  }, 10000)
})
