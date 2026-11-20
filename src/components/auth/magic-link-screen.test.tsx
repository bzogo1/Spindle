import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const search = vi.hoisted(() => ({ value: "" }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}))

vi.mock("@/lib/auth/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/auth-client")>()
  return {
    ...actual,
    verifyPasswordlessLink: vi.fn(),
    requestPasswordlessLink: vi.fn(),
  }
})

import {
  AuthApiError,
  requestPasswordlessLink,
  verifyPasswordlessLink,
} from "@/lib/auth/auth-client"
import { MagicLinkScreen } from "./magic-link-screen"
import { LanguageProvider } from "@/components/i18n/language-provider"

const verifyMock = vi.mocked(verifyPasswordlessLink)
const requestMock = vi.mocked(requestPasswordlessLink)

const originalLocation = window.location
let assignMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  search.value = ""
  verifyMock.mockReset()
  requestMock.mockReset().mockResolvedValue(undefined)
  assignMock = vi.fn()
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, assign: assignMock },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  // EmailLinkForm persists its resend cooldown in sessionStorage; clear it so
  // cooldowns cannot leak between tests.
  window.sessionStorage.clear()
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  })
})

describe("MagicLinkScreen", () => {
  it("shows the incomplete-link state when the token param is missing", () => {
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "This link is incomplete" })).toBeInTheDocument()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it("verifies the token once and redirects to the dashboard after a delay", async () => {
    search.value = "token=demo-token"
    verifyMock.mockResolvedValue({} as never)
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Signing you in")
    expect(verifyMock).toHaveBeenCalledTimes(1)
    expect(verifyMock).toHaveBeenCalledWith("demo-token")

    expect(
      await screen.findByRole("heading", { name: "You're signed in" }, { timeout: 2000 }),
    ).toBeInTheDocument()

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/dashboard"), { timeout: 2500 })
  }, 5000)

  it("redirects to a valid next param instead of the dashboard", async () => {
    search.value = "token=demo-token&next=%2Fdashboard%2Ffiles%3Ffolder%3Dlab"
    verifyMock.mockResolvedValue({} as never)
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "You're signed in" }, { timeout: 2000 }),
    ).toBeInTheDocument()

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/dashboard/files?folder=lab"), {
      timeout: 2500,
    })
  }, 5000)

  it("ignores an unsafe next param and falls back to the dashboard", async () => {
    search.value = "token=demo-token&next=%2F%2Fevil.example"
    verifyMock.mockResolvedValue({} as never)
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "You're signed in" }, { timeout: 2000 }),
    ).toBeInTheDocument()

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/dashboard"), {
      timeout: 2500,
    })
  }, 5000)

  it("surfaces the API error message for an invalid or expired token", async () => {
    search.value = "token=expired-token"
    verifyMock.mockRejectedValue(new AuthApiError("invalid_token", "This link has expired."))
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "This link didn't work" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("This link has expired.")
    expect(screen.getByRole("link", { name: "Back to Spindle" })).toHaveAttribute("href", "/")
    expect(assignMock).not.toHaveBeenCalled()
  })

  it("shows the configured expiry while verifying", () => {
    search.value = "token=demo-token"
    verifyMock.mockReturnValue(new Promise(() => {}))
    render(
      <LanguageProvider>
        <MagicLinkScreen expiresInMinutes={30} />
      </LanguageProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("This link expires in 30 minutes.")
  })

  it("shows the expired state with a resend form when the token expired", async () => {
    search.value = "token=expired-token&next=%2Fdashboard%2Ffiles"
    verifyMock.mockRejectedValue(
      new AuthApiError("invalid_token", "This sign-in link has expired.", 401, {
        reason: "expired",
      }),
    )
    render(
      <LanguageProvider>
        <MagicLinkScreen expiresInMinutes={30} />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "This sign-in link has expired" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Link expired")).toBeInTheDocument()
    expect(screen.getByText(/sign-in links only work for 30 minutes/i)).toBeInTheDocument()

    // Resend affordance: submitting the email form requests a fresh link and
    // preserves the sanitized `next` target.
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "ada@lab.edu" },
    })
    fireEvent.submit(document.querySelector("form")!)

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith({
        email: "ada@lab.edu",
        purpose: "signin",
        next: "/dashboard/files",
      }),
    )
    expect(
      await screen.findByText("A new sign-in link is on its way to ada@lab.edu."),
    ).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()

    // The resend cooldown is persisted under the magic-link-scoped key, not
    // the shared default, so it cannot leak into other auth flows.
    expect(window.sessionStorage.getItem("spindle:auth:resend-cooldown:magic-link")).not.toBeNull()
    expect(window.sessionStorage.getItem("spindle:auth:resend-cooldown")).toBeNull()
  })

  it("shows the used state when the token was already consumed", async () => {
    search.value = "token=used-token"
    verifyMock.mockRejectedValue(
      new AuthApiError("invalid_token", "This sign-in link has already been used.", 401, {
        reason: "used",
      }),
    )
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "This sign-in link was already used" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Link already used")).toBeInTheDocument()
  })

  it("falls back to generic copy for non-API failures", async () => {
    search.value = "token=demo-token"
    verifyMock.mockRejectedValue(new Error("boom"))
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "This link didn't work" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.")
  })

  it("offers a resend form on the invalid state and preserves next", async () => {
    search.value = "token=bad-token&next=%2Fdashboard%2Ffiles"
    verifyMock.mockRejectedValue(
      new AuthApiError("invalid_token", "This sign-in link isn't valid.", 401, {
        reason: "invalid",
      }),
    )
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(
      await screen.findByRole("heading", { name: "This link didn't work" }),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "ada@lab.edu" },
    })
    fireEvent.submit(document.querySelector("form")!)

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith({
        email: "ada@lab.edu",
        purpose: "signin",
        next: "/dashboard/files",
      }),
    )
  })

  it("offers a resend form when the token param is missing", async () => {
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "This link is incomplete" })).toBeInTheDocument()
    expect(screen.getByLabelText("Work email")).toBeInTheDocument()
    expect(verifyMock).not.toHaveBeenCalled()
  })

  it("shows a continue-now link pointing at the sanitized target after sign-in", async () => {
    search.value = "token=demo-token&next=%2Fdashboard%2Ffiles"
    verifyMock.mockResolvedValue({} as never)
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    const continueLink = await screen.findByRole("link", { name: "Continue now" })
    expect(continueLink).toHaveAttribute("href", "/dashboard/files")
  })

  it("rejects a backslash next param that would navigate off-site", async () => {
    // "/\evil.example" passes a naive "/" prefix check but URL parsers treat
    // "\" as "/", making it protocol-relative.
    search.value = "token=demo-token&next=%2F%5Cevil.example"
    verifyMock.mockResolvedValue({} as never)
    render(
      <LanguageProvider>
        <MagicLinkScreen />
      </LanguageProvider>,
    )

    const continueLink = await screen.findByRole("link", { name: "Continue now" })
    expect(continueLink).toHaveAttribute("href", "/dashboard")
  })
})
