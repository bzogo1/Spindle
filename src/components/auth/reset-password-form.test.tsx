import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ResetPasswordForm } from "./reset-password-form"

describe("ResetPasswordForm", () => {
  it("shows a clear next step for an expired token", () => {
    render(<ResetPasswordForm token="expired-token" />)

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
    const { rerender } = render(<ResetPasswordForm token="used-token" />)
    expect(
      screen.getByRole("heading", { name: "This reset link has already been used" }),
    ).toBeInTheDocument()

    rerender(<ResetPasswordForm token="bad-token" />)
    expect(screen.getByRole("heading", { name: "This reset link isn't valid" })).toBeInTheDocument()
  })

  it("catches a confirm-password mismatch on the client", async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm token="demo-token" />)

    await user.type(screen.getByLabelText("New password"), "correct horse")
    await user.type(screen.getByLabelText("Confirm new password"), "correct horsey")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(screen.getByRole("alert")).toHaveTextContent("Passwords don't match.")
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-invalid", "true")
  })

  it("toggles password visibility without disabling paste", async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm token="demo-token" />)

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
    const user = userEvent.setup()
    render(<ResetPasswordForm token="demo-token" />)

    await user.type(screen.getByLabelText("New password"), "correct horse")
    await user.type(screen.getByLabelText("Confirm new password"), "correct horse")
    await user.click(screen.getByRole("button", { name: "Update password" }))

    expect(
      await screen.findByRole("heading", { name: "Password updated" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/")
  })
})
