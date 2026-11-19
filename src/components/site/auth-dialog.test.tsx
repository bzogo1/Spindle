import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { AuthDialog } from "@/components/site/auth-dialog"
import { clearMockSession, getMockSession } from "@/components/site/auth/mock-auth"

const VALID_PASSWORD = "correct horse1"

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Sign in" }))
  return screen.getByRole("dialog")
}

afterEach(() => {
  clearMockSession()
})

describe("AuthDialog", () => {
  it("signs in, sets the mock session and closes the dialog", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    const form = within(dialog).getByRole("form", { name: "Sign in" })

    await user.type(within(dialog).getByLabelText("Work email"), "researcher@lab.edu")
    await user.type(within(dialog).getByLabelText("Password"), VALID_PASSWORD)
    await user.click(within(dialog).getByRole("button", { name: "Sign in" }))

    expect(form).toHaveAttribute("aria-busy", "true")
    expect(within(dialog).getByRole("button", { name: /Signing in/ })).toBeDisabled()

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
      timeout: 2000,
    })
    expect(getMockSession()?.user.email).toBe("researcher@lab.edu")
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveFocus()
  })

  it("shows a form-level alert for invalid credentials without closing", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText("Work email"), "researcher@lab.edu")
    await user.type(within(dialog).getByLabelText("Password"), "incorrect")
    await user.click(within(dialog).getByRole("button", { name: "Sign in" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Invalid email or password")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(getMockSession()).toBeNull()
  })

  it("validates required fields on submit and focuses the first invalid field", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("button", { name: "Sign in" }))

    expect(await within(dialog).findByText("Enter your work email.")).toBeInTheDocument()
    expect(within(dialog).getByText("Enter your password.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Work email")).toHaveAttribute("aria-invalid", "true")
    expect(within(dialog).getByLabelText("Work email")).toHaveFocus()
    expect(within(dialog).getByLabelText("Work email")).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("auth-email-error"),
    )
  })

  it("validates the email format on blur", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    const email = within(dialog).getByLabelText("Work email")
    await user.type(email, "not-an-email")
    await user.tab()

    expect(await within(dialog).findByText(/valid email address/)).toBeInTheDocument()
    expect(email).toHaveAttribute("aria-invalid", "true")
  })

  it("clears a field error once the user edits the field", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    const email = within(dialog).getByLabelText("Work email")
    await user.type(email, "bad")
    await user.tab()
    expect(await within(dialog).findByText(/valid email address/)).toBeInTheDocument()

    await user.clear(email)
    await user.type(email, "researcher@lab.edu")
    await waitFor(() => expect(email).not.toHaveAttribute("aria-invalid"))
    expect(within(dialog).queryByText(/valid email address/)).not.toBeInTheDocument()
    expect(within(dialog).queryByText("Enter your work email.")).not.toBeInTheDocument()
  })

  it("creates a workspace and advances to the verification-email step", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("tab", { name: "Create workspace" }))

    await user.type(within(dialog).getByLabelText("Workspace name"), "coastal-resilience")
    await user.type(within(dialog).getByLabelText("Work email"), "researcher@lab.edu")
    await user.type(within(dialog).getByLabelText("Password", { exact: true }), VALID_PASSWORD)
    await user.type(within(dialog).getByLabelText("Confirm password"), VALID_PASSWORD)
    await user.click(within(dialog).getByRole("checkbox", { name: /Terms of Service/ }))
    await user.click(within(dialog).getByRole("button", { name: "Create free workspace" }))

    expect(
      await within(dialog).findByRole("heading", { name: "Verify your email" }),
    ).toBeInTheDocument()
    expect(within(dialog).getAllByText("researcher@lab.edu").length).toBeGreaterThan(0)
    expect(getMockSession()).toBeNull()
  })

  it("shows the password rule list and marks rules as met", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("tab", { name: "Create workspace" }))

    const rules = within(dialog).getByRole("list", { name: "Password requirements" })
    expect(within(rules).getByText("At least 8 characters")).toBeInTheDocument()
    expect(within(rules).getByText("Contains a letter")).toBeInTheDocument()
    expect(within(rules).getByText("Contains a number")).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText("Password", { exact: true }), VALID_PASSWORD)
    await waitFor(() =>
      expect(within(rules).getByText("At least 8 characters").closest("li")).toHaveAttribute(
        "data-met",
        "true",
      ),
    )
  })

  it("requires the terms checkbox and blocks reserved workspace names", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("tab", { name: "Create workspace" }))

    await user.type(within(dialog).getByLabelText("Workspace name"), "admin")
    await user.type(within(dialog).getByLabelText("Work email"), "researcher@lab.edu")
    await user.type(within(dialog).getByLabelText("Password", { exact: true }), VALID_PASSWORD)
    await user.type(within(dialog).getByLabelText("Confirm password"), VALID_PASSWORD)
    await user.click(within(dialog).getByRole("button", { name: "Create free workspace" }))

    expect(await within(dialog).findByText(/reserved/)).toBeInTheDocument()
    expect(await within(dialog).findByText(/Accept the Terms of Service/)).toBeInTheDocument()
  })

  it("shows a form-level alert when the email is already registered", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("tab", { name: "Create workspace" }))

    await user.type(within(dialog).getByLabelText("Workspace name"), "coastal-resilience")
    await user.type(within(dialog).getByLabelText("Work email"), "taken@spindle.dev")
    await user.type(within(dialog).getByLabelText("Password", { exact: true }), VALID_PASSWORD)
    await user.type(within(dialog).getByLabelText("Confirm password"), VALID_PASSWORD)
    await user.click(within(dialog).getByRole("checkbox", { name: /Terms of Service/ }))
    await user.click(within(dialog).getByRole("button", { name: "Create free workspace" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/already exists/)
  })

  it("rejects a confirm-password mismatch before submitting", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("tab", { name: "Create workspace" }))

    await user.type(within(dialog).getByLabelText("Workspace name"), "coastal-resilience")
    await user.type(within(dialog).getByLabelText("Work email"), "researcher@lab.edu")
    await user.type(within(dialog).getByLabelText("Password", { exact: true }), VALID_PASSWORD)
    await user.type(within(dialog).getByLabelText("Confirm password"), "different1")
    await user.click(within(dialog).getByRole("checkbox", { name: /Terms of Service/ }))
    await user.click(within(dialog).getByRole("button", { name: "Create free workspace" }))

    expect(await within(dialog).findByText("Passwords don't match.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Confirm password")).toHaveFocus()
    expect(getMockSession()).toBeNull()
  })

  it("sends a reset link and shows the sent step", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole("button", { name: "Forgot password?" }))

    expect(within(dialog).getByRole("heading", { name: "Reset your password" })).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText("Work email"), "researcher@lab.edu")
    await user.click(within(dialog).getByRole("button", { name: "Send reset link" }))

    expect(await within(dialog).findByRole("heading", { name: "Link sent" })).toBeInTheDocument()
    expect(within(dialog).getAllByText("researcher@lab.edu").length).toBeGreaterThan(0)

    await user.click(within(dialog).getByRole("button", { name: "Resend email" }))
    expect(
      await within(dialog).findByRole("button", { name: /Resend in \d+s/ }, { timeout: 2000 }),
    ).toBeDisabled()

    await user.click(within(dialog).getByRole("button", { name: "Back to sign in" }))
    expect(within(dialog).getByRole("heading", { name: "Welcome to Spindle" })).toBeInTheDocument()
  })

  it("keeps OAuth buttons disabled with a coming-soon affordance", async () => {
    const user = userEvent.setup()
    render(<AuthDialog />)

    const dialog = await openDialog(user)
    expect(within(dialog).getByRole("button", { name: /Continue with Google/ })).toBeDisabled()
    expect(within(dialog).getByRole("button", { name: /Continue with GitHub/ })).toBeDisabled()
    expect(within(dialog).getAllByText("Coming soon")).toHaveLength(2)
  })

  it("opens directly on the create tab from the header event", async () => {
    render(<AuthDialog />)

    act(() => {
      window.dispatchEvent(new CustomEvent("spindle:open-auth", { detail: { tab: "create" } }))
    })

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("tab", { name: "Create workspace" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(within(dialog).getByLabelText("Workspace name")).toHaveFocus()
  })
})
