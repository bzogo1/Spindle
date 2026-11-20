import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AuthApiError } from "@/lib/auth/auth-client"

import { EmailLinkForm } from "./email-link-form"
import { notifyResendCooldown } from "./use-resend-cooldown"
import { LanguageProvider } from "@/components/i18n/language-provider"

afterEach(() => {
  // useResendCooldown persists its deadline in sessionStorage; clear it so
  // cooldowns cannot leak between tests.
  window.sessionStorage.clear()
  vi.useRealTimers()
})

function renderForm(overrides: Partial<Parameters<typeof EmailLinkForm>[0]> = {}) {
  const props = {
    idPrefix: "test",
    submitLabel: "Send sign-in link",
    sentMessage: (email: string) => `We sent a link to ${email}.`,
    ...overrides,
  }
  return {
    props,
    ...render(
      <LanguageProvider>
        <EmailLinkForm {...props} />
      </LanguageProvider>,
    ),
  }
}

describe("EmailLinkForm", () => {
  it("focuses the sent status and reports the transition via onSentChange", async () => {
    const user = userEvent.setup()
    const onSentChange = vi.fn()
    const onRequest = vi.fn().mockResolvedValue(undefined)
    renderForm({ onRequest, onSentChange })

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))

    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("We sent a link to researcher@lab.edu.")
    expect(status).toHaveFocus()
    expect(onSentChange).toHaveBeenLastCalledWith(true)
    expect(onRequest).toHaveBeenCalledWith("researcher@lab.edu")
  })

  it("shows an inline alert and stays on the form when the request fails", async () => {
    const user = userEvent.setup()
    const onRequest = vi.fn().mockRejectedValue(new Error("Too many requests. Slow down."))
    renderForm({ onRequest })

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests. Slow down.")
    expect(screen.getByLabelText("Work email")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("keeps the demo behaviour when no onRequest is provided", async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))

    expect(await screen.findByRole("status")).toBeInTheDocument()
  })

  it("locks resend during the cooldown, then resends with a confirmation notice", async () => {
    vi.useFakeTimers()
    const onRequest = vi.fn().mockResolvedValue(undefined)
    const { container } = renderForm({ onRequest })

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "researcher@lab.edu" },
    })
    fireEvent.submit(container.querySelector("form")!)
    await act(async () => {})
    expect(screen.getByRole("status")).toBeInTheDocument()

    // The initial send starts the cooldown: resend is locked for 60s.
    expect(screen.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled()

    // The cooldown re-arms a 1s timer per tick; advance one second at a time.
    for (let i = 0; i < 62; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }))
    await act(async () => {})

    expect(onRequest).toHaveBeenCalledTimes(2)
    expect(screen.getByText("A new link is on its way to researcher@lab.edu.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled()
  })

  it("shows the resend error inline and keeps resend usable", async () => {
    vi.useFakeTimers()
    const onRequest = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Mailbox unavailable."))
    const { container } = renderForm({ onRequest })

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "researcher@lab.edu" },
    })
    fireEvent.submit(container.querySelector("form")!)
    await act(async () => {})
    expect(screen.getByRole("status")).toBeInTheDocument()

    // The cooldown re-arms a 1s timer per tick; advance one second at a time.
    for (let i = 0; i < 62; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }))
    await act(async () => {})

    expect(screen.getByRole("alert")).toHaveTextContent("Mailbox unavailable.")
    expect(screen.queryByText(/A new link is on its way/)).not.toBeInTheDocument()
    // The failed resend does not restart the cooldown.
    expect(screen.getByRole("button", { name: "Resend email" })).toBeEnabled()
  })

  it("disables the submit button while a scoped cooldown is active", async () => {
    renderForm({ cooldownKey: "test-flow" })

    // Simulate a server 429 pushing retryAfter into this form's cooldown key.
    act(() => notifyResendCooldown(45, "test-flow"))

    const submit = screen.getByRole("button", { name: "Resend in 45s" })
    expect(submit).toBeDisabled()

    // A cooldown pushed to a different flow must not affect this form.
    act(() => notifyResendCooldown(90, "other-flow"))
    expect(screen.getByRole("button", { name: "Resend in 45s" })).toBeDisabled()
  })

  it("ignores programmatic submits while the cooldown is active", async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined)
    const { container } = renderForm({ onRequest, cooldownKey: "guard-flow" })

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "ada@lab.edu" },
    })
    act(() => notifyResendCooldown(30, "guard-flow"))

    // fireEvent.submit bypasses the disabled button, so the handler's own
    // guard is what must block the request.
    fireEvent.submit(container.querySelector("form")!)
    await act(async () => {})

    expect(onRequest).not.toHaveBeenCalled()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("syncs a server 429 retryAfter into the scoped cooldown", async () => {
    const user = userEvent.setup()
    const onRequest = vi
      .fn()
      .mockRejectedValue(new AuthApiError("rate_limited", "Slow down.", 429, { retryAfter: 45 }))
    renderForm({ onRequest, cooldownKey: "retry-flow" })

    await user.type(screen.getByLabelText("Work email"), "ada@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))

    // The failed submit still surfaces the server message…
    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down.")
    // …and the button now counts down the server-provided window.
    expect(await screen.findByRole("button", { name: "Resend in 45s" })).toBeDisabled()
    // Scoped to this flow's key only (cooldownKey is the sessionStorage key).
    expect(window.sessionStorage.getItem("retry-flow")).not.toBeNull()
  })

  it("ignores a 429 retryAfter when no cooldownKey is set", async () => {
    const user = userEvent.setup()
    const onRequest = vi
      .fn()
      .mockRejectedValue(new AuthApiError("rate_limited", "Slow down.", 429, { retryAfter: 45 }))
    renderForm({ onRequest })

    await user.type(screen.getByLabelText("Work email"), "ada@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Slow down.")
    expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeEnabled()
  })

  it("resets the sent state and cooldown when switching to a different email", async () => {
    const user = userEvent.setup()
    const onSentChange = vi.fn()
    const onRequest = vi.fn().mockResolvedValue(undefined)
    renderForm({ onRequest, onSentChange })

    await user.type(screen.getByLabelText("Work email"), "first@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await screen.findByRole("status")

    await user.click(screen.getByRole("button", { name: "Use a different email" }))

    expect(screen.getByLabelText("Work email")).toHaveValue("first@lab.edu")
    expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeInTheDocument()
    expect(onSentChange).toHaveBeenLastCalledWith(false)
  })
})
