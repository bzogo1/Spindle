import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useAuthSession, type SessionContextValue } from "@/components/auth/session-provider"
import { requestEmailVerification } from "@/lib/auth/auth-client"
import { toast } from "@/components/ui/toast"

import { LanguageProvider } from "@/components/i18n/language-provider"

import { SiteSessionMenu } from "./site-session-menu"

vi.mock("@/components/auth/session-provider", () => ({
  useAuthSession: vi.fn(),
}))

vi.mock("@/lib/auth/auth-client", () => ({
  requestEmailVerification: vi.fn(),
}))

vi.mock("@/components/ui/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const session = vi.mocked(useAuthSession)
const requestVerification = vi.mocked(requestEmailVerification)
const toastMock = vi.mocked(toast)

function mockSession(overrides: Partial<SessionContextValue> = {}) {
  session.mockReturnValue({
    user: null,
    workspace: null,
    session: null,
    status: "unauthenticated",
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  })
}

const authenticatedUser = {
  id: "u1",
  email: "bogdan@example.com",
  name: "Bogdan Zogovic",
  emailVerified: true,
}

describe("SiteSessionMenu", () => {
  beforeEach(() => {
    session.mockReset()
    requestVerification.mockReset().mockResolvedValue(undefined)
    toastMock.success.mockClear()
    toastMock.error.mockClear()
  })

  it("renders a placeholder while the session is loading", () => {
    mockSession({ status: "loading" })

    const { container } = render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )

    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument()
  })

  it("links to the sign-in page when unauthenticated", () => {
    mockSession({ status: "unauthenticated" })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in")
  })

  it("shows the user's name and opens the account menu when authenticated", async () => {
    mockSession({
      status: "authenticated",
      user: authenticatedUser,
      session: {
        user: authenticatedUser,
        workspace: null,
        sessionId: "s1",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )

    const trigger = screen.getByRole("button", { name: "Account menu" })
    expect(trigger).toHaveTextContent("Bogdan Zogovic")

    await userEvent.click(trigger)

    expect(screen.getByText("bogdan@example.com")).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Open app/ })).toHaveAttribute("href", "/dashboard")
    expect(screen.getByRole("menuitem", { name: /Account settings/ })).toHaveAttribute(
      "href",
      "/app/account",
    )
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()
  })

  it("falls back to the email when the user has no name", async () => {
    mockSession({
      status: "authenticated",
      user: { ...authenticatedUser, name: null },
    })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )

    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent(
      "bogdan@example.com",
    )
  })

  it("hides the verify-email item when the user's email is already verified", async () => {
    mockSession({
      status: "authenticated",
      user: authenticatedUser,
    })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))

    expect(screen.queryByRole("menuitem", { name: /Verify your email/ })).not.toBeInTheDocument()
  })

  it("requests a verification email when the user's email is unverified", async () => {
    mockSession({
      status: "authenticated",
      user: { ...authenticatedUser, emailVerified: false },
    })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))

    const item = screen.getByRole("menuitem", { name: /Verify your email/ })
    await userEvent.click(item)

    await waitFor(() => {
      expect(requestVerification).toHaveBeenCalledWith("bogdan@example.com")
    })
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalled()
    })
  })

  it("shows an error toast when the verification request fails", async () => {
    requestVerification.mockRejectedValue(new Error("Network error"))
    mockSession({
      status: "authenticated",
      user: { ...authenticatedUser, emailVerified: false },
    })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))
    await userEvent.click(screen.getByRole("menuitem", { name: /Verify your email/ }))

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled()
    })
  })

  it("calls session signOut when Sign out is selected", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    mockSession({
      status: "authenticated",
      user: authenticatedUser,
      signOut,
    })

    render(
      <LanguageProvider>
        <SiteSessionMenu />
      </LanguageProvider>,
    )
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
