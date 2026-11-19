import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const search = vi.hoisted(() => ({ value: "" }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}))

import { VerifyEmailScreen } from "./verify-email-screen"

describe("VerifyEmailScreen", () => {
  beforeEach(() => {
    search.value = ""
  })

  it("shows a fresh-link form when no token is present", async () => {
    const user = userEvent.setup()
    render(<VerifyEmailScreen />)

    expect(screen.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument()

    await user.type(screen.getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(screen.getByRole("button", { name: "Send verification email" }))

    expect(screen.getByRole("heading", { name: "Check your inbox" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled()
  })

  it("verifies a valid token", async () => {
    search.value = "token=demo-token"
    render(<VerifyEmailScreen />)

    expect(
      await screen.findByRole("heading", { name: "Email verified" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Continue to Spindle" })).toHaveAttribute("href", "/")
  })

  it("shows the expired state and a resend form", async () => {
    search.value = "token=expired-token&email=researcher@lab.edu"
    render(<VerifyEmailScreen />)

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
})
