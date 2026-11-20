import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const search = vi.hoisted(() => ({ value: "" }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}))

import { VerifyEmailScreen } from "./verify-email-screen"
import { LanguageProvider } from "@/components/i18n/language-provider"

describe("VerifyEmailScreen", () => {
  beforeEach(() => {
    search.value = ""
    window.sessionStorage.clear()
  })

  it("shows a fresh-link form when no token is present", async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <VerifyEmailScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument()

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, sent: true, retryAfter: 60 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send verification email" }))

    expect(screen.getByRole("heading", { name: "Check your inbox" })).toBeInTheDocument()
    // The server-reported retryAfter drives the countdown.
    expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled()
  })

  it("verifies a valid token", async () => {
    search.value = "token=demo-token"
    render(
      <LanguageProvider>
        <VerifyEmailScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "Email verified" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Continue to Spindle" })).toHaveAttribute("href", "/")
  })

  it("shows the expired state and a resend form", async () => {
    search.value = "token=expired-token&email=researcher@lab.edu"
    render(
      <LanguageProvider>
        <VerifyEmailScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole(
        "heading",
        { name: "This verification link has expired" },
        { timeout: 2000 },
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Work email")).toHaveValue("researcher@lab.edu")
    expect(screen.getByRole("button", { name: "Send verification email" })).toBeInTheDocument()
  })

  it("syncs the resend countdown with the server retryAfter on 429", async () => {
    vi.useFakeTimers()

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, sent: true, retryAfter: 60 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            code: "rate_limited",
            message: "Please wait a moment before requesting another verification email.",
            retryAfter: 42,
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      )

    const { container } = render(
      <LanguageProvider>
        <VerifyEmailScreen />
      </LanguageProvider>,
    )

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "researcher@lab.edu" },
    })
    fireEvent.submit(container.querySelector("form")!)
    await act(async () => {})

    // First send succeeded: the resend button is cooling down locally.
    expect(screen.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled()

    // The cooldown re-arms a 1s timer per tick; advance one second at a time
    // until the local 60s cooldown elapses and resend becomes clickable.
    for (let i = 0; i < 62; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }
    const resendButton = screen.getByRole("button", { name: "Resend email" })
    expect(resendButton).toBeEnabled()

    fireEvent.click(resendButton)
    await act(async () => {})

    // The server's retryAfter (42s) replaces the local countdown and the
    // failure surfaces inline.
    expect(screen.getByRole("button", { name: "Resend in 42s" })).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please wait a moment before requesting another verification email.",
    )
    expect(vi.mocked(globalThis.fetch)).toHaveBeenLastCalledWith(
      "/api/auth/verify-email/resend",
      expect.objectContaining({ method: "POST" }),
    )

    vi.useRealTimers()
  })
})
