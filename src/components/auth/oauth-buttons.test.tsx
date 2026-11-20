import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth-client")>()
  return { ...actual, beginOAuthSignIn: vi.fn() }
})

import { AuthApiError, beginOAuthSignIn } from "@/lib/auth/auth-client"
import { OAuthButtons } from "./oauth-buttons"
import { LanguageProvider } from "@/components/i18n/language-provider"

const beginOAuthMock = vi.mocked(beginOAuthSignIn)

describe("OAuthButtons", () => {
  it("shows Google, GitHub and GitLab as unavailable until the server configures them", () => {
    render(
      <LanguageProvider>
        <OAuthButtons providers={[]} />
      </LanguageProvider>,
    )

    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Continue with GitHub/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Continue with GitLab/ })).toBeDisabled()
    expect(screen.getAllByText("Soon")).toHaveLength(3)
  })

  it("starts the PKCE flow for a configured provider", async () => {
    const user = userEvent.setup()
    beginOAuthMock.mockResolvedValue(undefined)
    render(
      <LanguageProvider>
        <OAuthButtons providers={["github"]} returnTo="/dashboard/files" />
      </LanguageProvider>,
    )

    await user.click(screen.getByRole("button", { name: /Continue with GitHub/ }))

    expect(beginOAuthMock).toHaveBeenCalledWith({
      provider: "github",
      returnTo: "/dashboard/files",
    })
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Continue with GitLab/ })).toBeDisabled()
  })

  it("starts the PKCE flow for a configured GitLab provider", async () => {
    const user = userEvent.setup()
    beginOAuthMock.mockResolvedValue(undefined)
    render(
      <LanguageProvider>
        <OAuthButtons providers={["gitlab"]} />
      </LanguageProvider>,
    )

    await user.click(screen.getByRole("button", { name: /Continue with GitLab/ }))

    expect(beginOAuthMock).toHaveBeenCalledWith({ provider: "gitlab", returnTo: undefined })
    expect(screen.getByRole("button", { name: /Continue with GitLab/ })).toBeEnabled()
  })

  it("surfaces provider errors inline", async () => {
    const user = userEvent.setup()
    beginOAuthMock.mockRejectedValue(
      new AuthApiError("oauth_failed", "Sign-in with the provider failed. Try again.", 401),
    )
    render(
      <LanguageProvider>
        <OAuthButtons providers={["google"]} />
      </LanguageProvider>,
    )

    await user.click(screen.getByRole("button", { name: /Continue with Google/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign-in with the provider failed. Try again.",
    )
  })
})
