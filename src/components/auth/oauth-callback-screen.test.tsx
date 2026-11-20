import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const search = vi.hoisted(() => ({ value: "" }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}))

vi.mock("@/lib/auth/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth-client")>()
  return { ...actual, completeOAuthSignIn: vi.fn() }
})

import { AuthApiError, completeOAuthSignIn } from "@/lib/auth/auth-client"
import type { ClientSession } from "@/lib/auth/auth-client"
import { OAuthCallbackScreen } from "./oauth-callback-screen"
import { LanguageProvider } from "@/components/i18n/language-provider"

const completeMock = vi.mocked(completeOAuthSignIn)

const session = {
  user: { id: "u1", email: "researcher@lab.edu", name: null, emailVerified: true },
  workspace: null,
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
} satisfies ClientSession

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  search.value = ""
  completeMock.mockReset()
  assignMock = vi.fn()
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, assign: assignMock },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  })
})

describe("OAuthCallbackScreen", () => {
  it("shows the incomplete state when code or state is missing", () => {
    search.value = "code=abc"
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "This link is incomplete" })).toBeInTheDocument()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it("shows the provider-cancelled message when the provider returns an error", () => {
    search.value = "error=access_denied&provider=google"
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "Sign-in didn't finish" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The provider cancelled or denied the sign-in.",
    )
    expect(completeMock).not.toHaveBeenCalled()
  })

  it("completes sign-in and redirects to the stored return path", async () => {
    search.value = "code=abc&state=xyz&provider=google"
    completeMock.mockResolvedValue({ session, returnTo: "/projects", provider: "google" })
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Finishing sign-in")
    expect(completeMock).toHaveBeenCalledWith({ provider: "google", code: "abc", state: "xyz" })

    expect(
      await screen.findByRole("heading", { name: "You're signed in" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/projects"), {
      timeout: 2000,
    })
  }, 5000)

  it("falls back to / when the stored return path is not local", async () => {
    search.value = "code=abc&state=xyz"
    completeMock.mockResolvedValue({
      session,
      returnTo: "https://evil.example",
      provider: "google",
    })
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "You're signed in" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/"), { timeout: 2000 })
  }, 5000)

  it("falls back to / for a protocol-relative return path", async () => {
    search.value = "code=abc&state=xyz"
    completeMock.mockResolvedValue({
      session,
      // "//host" starts with "/" but navigates off-site — must be rejected.
      returnTo: "//evil.example",
      provider: "google",
    })
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "You're signed in" }, { timeout: 2000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/"), { timeout: 2000 })
  }, 5000)

  it("surfaces the API error for a failed exchange", async () => {
    search.value = "code=abc&state=xyz"
    completeMock.mockRejectedValue(new AuthApiError("oauth_failed", "Provider exchange failed."))
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "Sign-in didn't finish" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Provider exchange failed.")
    expect(assignMock).not.toHaveBeenCalled()
  })

  it("uses generic copy for non-API failures", async () => {
    search.value = "code=abc&state=xyz"
    completeMock.mockRejectedValue(new Error("boom"))
    render(
      <LanguageProvider>
        <OAuthCallbackScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "Sign-in didn't finish" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.")
  })
})
