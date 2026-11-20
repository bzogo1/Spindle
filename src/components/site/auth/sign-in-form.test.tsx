import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ClientSession } from "@/lib/auth/auth-client"
import { LanguageProvider } from "@/components/i18n/language-provider"
import { SignInForm } from "./sign-in-form"

const fetchMock = vi.mocked(globalThis.fetch)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const clientSession: ClientSession = {
  user: { id: "u1", email: "researcher@lab.edu", name: "Researcher", emailVerified: true },
  workspace: { name: "Lab", slug: "lab" },
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

function renderForm(props?: { next?: string }) {
  const onSuccess = vi.fn()
  const onForgotPassword = vi.fn()
  render(
    <LanguageProvider>
      <SignInForm onSuccess={onSuccess} onForgotPassword={onForgotPassword} {...props} />
    </LanguageProvider>,
  )
  return { onSuccess, onForgotPassword }
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>, password = "hunter2") {
  await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
  await user.type(screen.getByLabelText("Password"), password)
}

afterEach(() => {
  fetchMock.mockReset()
})

describe("SignInForm", () => {
  it("signs in against the real API and reports the session", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, status: "ok", session: clientSession }))
    const { onSuccess } = renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess.mock.calls[0][0].user.email).toBe("researcher@lab.edu")
    expect(onSuccess.mock.calls[0][1]).toEqual(clientSession)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/signin",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("maps invalid_credentials API errors to the friendly form error", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, code: "invalid_credentials", message: "Invalid email or password." },
        401,
      ),
    )
    renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password. Check your details and try again.",
    )
  })

  it("surfaces other AuthApiError messages verbatim", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, code: "rate_limited", message: "Too many attempts. Try later." },
        429,
      ),
    )
    renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Try later.")
  })

  it("falls back to the mock sign-in when the API is unreachable", async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValue(new Error("connection refused"))
    const { onSuccess } = renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(onSuccess.mock.calls[0][0].user.email).toBe("researcher@lab.edu")
    expect(onSuccess.mock.calls[0][1]).toBeNull()
  }, 5000)

  it("surfaces mock invalid credentials through the fallback path", async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValue(new Error("connection refused"))
    renderForm()

    await fillCredentials(user, "incorrect")
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password. Check your details and try again.",
    )
  }, 5000)

  it("switches to the TOTP challenge and verifies the code", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, status: "totp_required", challenge: "ch-123" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, session: clientSession }))
    const { onSuccess } = renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    const codeInput = await screen.findByLabelText("Authentication code")
    expect(screen.getByRole("form", { name: "Two-factor verification" })).toBeInTheDocument()

    await user.type(codeInput, "123456")
    await user.click(screen.getByRole("button", { name: "Verify" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess.mock.calls[0][1]).toEqual(clientSession)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/2fa/verify-login",
      expect.objectContaining({
        body: JSON.stringify({ challenge: "ch-123", code: "123456", remember: true }),
      }),
    )
  })

  it("shows the TOTP error and returns to the password form via Back", async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, status: "totp_required", challenge: "ch-123" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, code: "totp_invalid", message: "That code is not valid." }, 400),
      )
    renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await user.type(await screen.findByLabelText("Authentication code"), "000000")
    await user.click(screen.getByRole("button", { name: "Verify" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not valid.")

    await user.click(screen.getByRole("button", { name: "Back to sign in" }))
    expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Authentication code")).not.toBeInTheDocument()
  })

  it("requests a magic link and confirms it was sent", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    renderForm()

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }))

    const sent = await screen.findByRole("button", {
      name: "Sign-in link sent — check your inbox",
    })
    expect(sent).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/passwordless/request",
      expect.objectContaining({
        body: JSON.stringify({ email: "researcher@lab.edu", purpose: "signin" }),
      }),
    )
  })

  it("forwards the next prop to the magic-link request", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    renderForm({ next: "/projects/abc?tab=files" })

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }))

    await screen.findByRole("button", { name: "Sign-in link sent — check your inbox" })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/passwordless/request",
      expect.objectContaining({
        body: JSON.stringify({
          email: "researcher@lab.edu",
          purpose: "signin",
          next: "/projects/abc?tab=files",
        }),
      }),
    )
  })

  it("rejects a magic-link request for an invalid email without calling the API", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText("Work email"), "not-an-email")
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }))

    // Both the field-level hint and the form-level alert may render; the
    // form-level one carries the sign-in-link guidance.
    const alerts = await screen.findAllByRole("alert")
    expect(
      alerts.some((alert) =>
        alert.textContent?.includes("Enter a valid email address to get a sign-in link."),
      ),
    ).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces magic-link request errors and allows retry", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "rate_limited", message: "Slow down." }, 429),
    )
    renderForm()

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link instead" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down.")
    expect(screen.getByRole("button", { name: "Email me a sign-in link instead" })).toBeEnabled()
  })

  it("shows a lockout countdown and disables submit on account_locked", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "account_locked",
          message: "Too many failed sign-in attempts. Try again later.",
          retryAfter: 900,
        },
        429,
      ),
    )
    renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Too many failed sign-in attempts. Try again in 15m.")
    // Distinct from the bad-credentials error.
    expect(alert).not.toHaveTextContent("Invalid email or password")
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Email me a sign-in link instead" })).toBeDisabled()
  })

  it("re-enables submit once the lockout countdown expires", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "account_locked",
          message: "Too many failed sign-in attempts. Try again later.",
          retryAfter: 1,
        },
        429,
      ),
    )
    renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in")
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled(), {
      timeout: 5000,
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  }, 8000)

  it("clears the lockout countdown when the email changes", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: "account_locked",
          message: "Too many failed sign-in attempts. Try again later.",
          retryAfter: 900,
        },
        429,
      ),
    )
    renderForm()

    await fillCredentials(user)
    await user.click(screen.getByRole("button", { name: "Sign in" }))
    await screen.findByRole("alert")
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled()

    const emailInput = screen.getByLabelText("Work email")
    await user.clear(emailInput)
    await user.type(emailInput, "someone-else@lab.edu")

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("ignores a second submit while the first is in flight", async () => {
    let resolveFetch!: (response: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const { onSuccess } = renderForm()

    await userEvent.setup().type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await userEvent.setup().type(screen.getByLabelText("Password"), "hunter2")

    const form = screen.getByRole("form", { name: "Sign in" })
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    resolveFetch(jsonResponse({ ok: true, status: "ok", session: clientSession }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("SignInForm security-key sign-in", () => {
  function enableWebauthn(get: ReturnType<typeof vi.fn>) {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: class PublicKeyCredential {},
      configurable: true,
      writable: true,
    })
    Object.defineProperty(navigator, "credentials", {
      value: { get },
      configurable: true,
    })
  }

  function disableWebauthn() {
    // @ts-expect-error test cleanup
    delete window.PublicKeyCredential
    // @ts-expect-error test cleanup
    delete navigator.credentials
  }

  const beginResponse = {
    ok: true,
    challengeId: "challenge-1",
    options: {
      challenge: "QUJDREVGRw",
      rpId: "localhost",
      timeout: 60_000,
      allowCredentials: [],
      userVerification: "preferred",
    },
  }

  function fakeAssertionCredential() {
    return {
      id: "credential-id",
      rawId: new Uint8Array([9, 8, 7]).buffer,
      type: "public-key",
      authenticatorAttachment: "cross-platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: new Uint8Array([1, 2]).buffer,
        authenticatorData: new Uint8Array([3, 4]).buffer,
        signature: new Uint8Array([5, 6]).buffer,
        userHandle: null,
      },
    } as unknown as PublicKeyCredential
  }

  afterEach(() => {
    disableWebauthn()
  })

  it("hides the security-key button when WebAuthn is unsupported", () => {
    disableWebauthn()
    renderForm()

    expect(
      screen.queryByRole("button", { name: "Sign in with a passkey or security key" }),
    ).not.toBeInTheDocument()
  })

  it("runs the begin → get → complete ceremony and reports the session", async () => {
    const user = userEvent.setup()
    const get = vi.fn().mockResolvedValue(fakeAssertionCredential())
    enableWebauthn(get)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(beginResponse))
      .mockResolvedValueOnce(jsonResponse({ ok: true, session: clientSession }))
    const { onSuccess } = renderForm()

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey or security key" }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess.mock.calls[0][1]).toEqual(clientSession)
    expect(get).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/webauthn/auth/begin",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/webauthn/auth/complete",
      expect.objectContaining({
        body: expect.stringContaining('"challengeId":"challenge-1"'),
      }),
    )
  })

  it("surfaces invalid-assertion errors from auth/complete", async () => {
    const user = userEvent.setup()
    enableWebauthn(vi.fn().mockResolvedValue(fakeAssertionCredential()))
    fetchMock.mockResolvedValueOnce(jsonResponse(beginResponse)).mockResolvedValueOnce(
      jsonResponse(
        {
          ok: false,
          code: "invalid_assertion",
          message: "The security key response is invalid.",
        },
        401,
      ),
    )
    renderForm()

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey or security key" }))

    // The field-level email hint also carries role="alert"; assert on the
    // form-level alert specifically.
    const alerts = await screen.findAllByRole("alert")
    expect(
      alerts.some((alert) => alert.textContent?.includes("The security key response is invalid.")),
    ).toBe(true)
    expect(document.querySelector(".auth-form-alert")).toHaveTextContent(
      "The security key response is invalid.",
    )
  })

  it("stays silent when the user dismisses the security-key prompt", async () => {
    const user = userEvent.setup()
    enableWebauthn(vi.fn().mockRejectedValue(new DOMException("Dismissed.", "NotAllowedError")))
    fetchMock.mockResolvedValueOnce(jsonResponse(beginResponse))
    const { onSuccess } = renderForm()

    await user.click(screen.getByRole("button", { name: "Sign in with a passkey or security key" }))

    // Give the rejection a tick to settle, then assert no error surfaced.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sign in with a passkey or security key" }),
      ).toBeEnabled(),
    )
    // The field-level email hint has role="alert" too; the form-level
    // error slot (.auth-form-alert) is what a failed ceremony would use.
    expect(document.querySelector(".auth-form-alert")).not.toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
