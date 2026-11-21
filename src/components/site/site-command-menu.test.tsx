import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { LanguageProvider } from "@/components/i18n/language-provider"

import { SITE_SEARCH_OPEN_EVENT, SiteCommandMenu } from "./site-command-menu"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
}))

async function openMenu() {
  render(
    <LanguageProvider>
      <SiteCommandMenu />
    </LanguageProvider>,
  )
  await userEvent.click(screen.getByRole("button", { name: "Search" }))
  const input = await screen.findByRole("combobox", { name: "Search site" })
  // Providers load asynchronously; wait for the first group to land.
  await screen.findByRole("group", { name: "Pages" })
  return input
}

describe("SiteCommandMenu", () => {
  beforeEach(() => {
    navigationMocks.push.mockReset()
    window.localStorage.clear()
  })

  it("opens from the header button and lists pages, docs, changelog, and actions", async () => {
    await openMenu()

    expect(screen.getByRole("group", { name: "Pages" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Docs" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Changelog" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Pricing/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Sign in/ })).toBeInTheDocument()
    expect(screen.getByText(/Navigate/)).toBeInTheDocument()
    expect(screen.getByText(/Select/)).toBeInTheDocument()
  })

  it("wires combobox ARIA to the listbox and active option", async () => {
    const input = await openMenu()

    expect(input).toHaveAttribute("aria-autocomplete", "list")
    expect(input).toHaveAttribute("aria-expanded", "true")
    const listbox = screen.getByRole("listbox")
    expect(input.getAttribute("aria-controls")).toBe(listbox.id)

    const active = screen.getAllByRole("option")[0]
    expect(input.getAttribute("aria-activedescendant")).toBe(active.id)
    // With an empty query nothing is highlighted until the mouse hovers an item.
    expect(active).toHaveAttribute("aria-selected", "false")
  })

  it("opens when the mobile nav dispatches the open event", async () => {
    render(
      <LanguageProvider>
        <SiteCommandMenu />
      </LanguageProvider>,
    )

    act(() => {
      window.dispatchEvent(new Event(SITE_SEARCH_OPEN_EVENT))
    })

    expect(await screen.findByRole("combobox", { name: "Search site" })).toBeInTheDocument()
  })

  it("opens with Ctrl+K", async () => {
    render(
      <LanguageProvider>
        <SiteCommandMenu />
      </LanguageProvider>,
    )

    await userEvent.keyboard("{Control>}k{/Control}")

    expect(await screen.findByRole("combobox", { name: "Search site" })).toBeInTheDocument()
  })

  it("fuzzy-filters pages as the query changes", async () => {
    const input = await openMenu()

    await userEvent.type(input, "privacy")

    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /Pricing/ })).not.toBeInTheDocument()
    })
    expect(screen.getByRole("option", { name: /Privacy Policy/ })).toBeInTheDocument()
  })

  it("finds docs guides and changelog releases through the unified index", async () => {
    const input = await openMenu()

    await userEvent.type(input, "changelog")
    await userEvent.keyboard("{Enter}")

    await waitFor(() => {
      expect(navigationMocks.push).toHaveBeenCalledWith(expect.stringContaining("/changelog"))
    })
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument())
  })

  it("navigates to a page with arrow keys and Enter", async () => {
    const input = await openMenu()

    await userEvent.type(input, "automations")
    await userEvent.keyboard("{Enter}")

    expect(navigationMocks.push).toHaveBeenCalledWith("/automations")
  })

  it("navigates to the auth pages for sign-in actions", async () => {
    const input = await openMenu()
    await userEvent.type(input, "sign in")
    await userEvent.keyboard("{Enter}")

    expect(navigationMocks.push).toHaveBeenCalledWith("/sign-in")
  })

  it("shows recently used items when reopened with an empty query", async () => {
    const input = await openMenu()
    await userEvent.type(input, "pricing")
    await userEvent.keyboard("{Enter}")

    expect(navigationMocks.push).toHaveBeenCalledWith("/pricing")

    await userEvent.click(screen.getByRole("button", { name: "Search" }))

    const recent = await screen.findByRole("group", { name: "Recent" })
    expect(recent).toHaveTextContent("Pricing")
  })
})
