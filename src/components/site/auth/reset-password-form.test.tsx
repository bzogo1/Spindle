import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"
import { ResetPasswordForm } from "./reset-password-form"

const fetchMock = vi.mocked(globalThis.fetch)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function renderForm() {
  const onSent = vi.fn()
  const onBack = vi.fn()
  render(
    <LanguageProvider>
      <ResetPasswordForm onSent={onSent} onBack={onBack} />
    </LanguageProvider>,
  )
  return { onSent, onBack }
}

afterEach(() => {
  fetchMock.mockReset()
})

describe("ResetPasswordForm", () => {
  it("requests a reset link and reports the email once sent", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    const { onSent } = renderForm()

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    await waitFor(() => expect(onSent).toHaveBeenCalledWith("researcher@lab.edu"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password/reset/request",
      expect.objectContaining({ body: JSON.stringify({ email: "researcher@lab.edu" }) }),
    )
  })

  it("shows the generic error when the request fails", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "rate_limited", message: "Slow down." }, 429),
    )
    const { onSent } = renderForm()

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Check your connection and try again.",
    )
    expect(onSent).not.toHaveBeenCalled()
  })

  it("focuses the email field when submitting an empty form", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole("button", { name: "Send reset link" }))

    expect(await screen.findByText("Enter your work email.")).toBeInTheDocument()
    expect(screen.getByLabelText("Work email")).toHaveFocus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ignores a second submit while the first is in flight", async () => {
    let resolveFetch!: (response: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const { onSent } = renderForm()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")

    const form = screen.getByRole("form", { name: "Reset password" })
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    resolveFetch(jsonResponse({ ok: true }))
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("researcher@lab.edu"))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("invokes onBack from the back link", async () => {
    const user = userEvent.setup()
    const { onBack } = renderForm()

    await user.click(screen.getByRole("button", { name: /Back to sign in/ }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
