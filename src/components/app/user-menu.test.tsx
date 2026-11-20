import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useMockSession } from "@/components/app/mock-session-provider"

import { UserMenu } from "./user-menu"

vi.mock("@/components/app/mock-session-provider", () => ({
  useMockSession: vi.fn(),
}))

// The revoke-all dialog has its own test suite; here we only verify the menu
// item opens it.
vi.mock("@/components/app/revoke-all-sessions-button", () => ({
  RevokeAllSessionsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="revoke-all-dialog" /> : null,
}))

const session = vi.mocked(useMockSession)

function mockSession(overrides: Partial<ReturnType<typeof useMockSession>> = {}) {
  session.mockReturnValue({
    user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
    workspace: { name: "Tidal Lab", slug: "tidal-lab" },
    status: "authenticated",
    workspaces: [],
    signIn: vi.fn(),
    signOut: vi.fn(),
    switchWorkspace: vi.fn(),
    ...overrides,
  })
}

describe("UserMenu", () => {
  beforeEach(() => {
    session.mockReset()
    document.documentElement.classList.remove("dark")
    window.localStorage.clear()
  })

  it("shows the user's name on the trigger and opens the menu with profile and links", async () => {
    mockSession()

    render(<UserMenu />)

    const trigger = screen.getByRole("button", { name: /account menu/i })
    expect(trigger).toHaveTextContent("Bogdan Zogovic")

    await userEvent.click(trigger)

    expect(screen.getByText("bogdan@example.com")).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Profile/ })).toHaveAttribute(
      "href",
      "/app/profile",
    )
    expect(screen.getByRole("menuitem", { name: /Account settings/ })).toHaveAttribute(
      "href",
      "/app/account",
    )
    expect(screen.getByRole("menuitem", { name: /Workspace settings/ })).toHaveAttribute(
      "href",
      "/app/settings",
    )
    expect(screen.getByRole("menuitem", { name: "Docs" })).toHaveAttribute("href", "/docs")
    expect(screen.getByRole("menuitem", { name: "Help" })).toHaveAttribute("href", "/docs/faq")
    expect(screen.getByRole("menuitem", { name: "Sign out everywhere" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()
  })

  it("opens the revoke-all-sessions dialog from the menu", async () => {
    mockSession()

    render(<UserMenu />)
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out everywhere" }))

    expect(screen.getByTestId("revoke-all-dialog")).toBeInTheDocument()
  })

  it("selects the dark theme from the theme radio group", async () => {
    mockSession()

    render(<UserMenu />)
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }))

    const group = screen.getByRole("group", { name: "Theme" })
    expect(group).toBeInTheDocument()

    const darkOption = screen.getByRole("menuitemradio", { name: "Dark" })
    expect(darkOption).toHaveAttribute("aria-checked", "false")

    await userEvent.click(darkOption)

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(window.localStorage.getItem("spindle-app-theme")).toBe("dark")
  })

  it("marks the current theme as checked in the radio group", async () => {
    document.documentElement.classList.add("dark")
    mockSession()

    render(<UserMenu />)
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }))

    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })

  it("calls signOut from the session when Sign out is selected", async () => {
    const signOut = vi.fn()
    mockSession({ signOut })

    render(<UserMenu />)
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("opens and closes from the keyboard", async () => {
    mockSession()

    render(<UserMenu />)
    const trigger = screen.getByRole("button", { name: /account menu/i })

    trigger.focus()
    await userEvent.keyboard("{Enter}")
    expect(screen.getByRole("menu")).toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
})
