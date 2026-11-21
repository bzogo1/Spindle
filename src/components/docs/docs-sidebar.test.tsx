import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DocsNavSection } from "@/lib/docs"

import { DocsSidebar } from "./docs-sidebar"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const groups: DocsNavSection[] = [
  {
    title: "Getting started",
    guides: [
      { id: "intro", title: "Introduction" },
      { id: "install", title: "Installation" },
    ],
  },
  {
    title: "Workspace",
    guides: [{ id: "search", title: "Search" }],
  },
  {
    title: "Roadmap",
    guides: [],
  },
]

beforeEach(() => {
  window.history.replaceState(null, "", "/docs/install")
})

describe("DocsSidebar", () => {
  it("links every guide under /docs/<id> and marks the current one", async () => {
    const user = userEvent.setup()
    render(<DocsSidebar groups={groups} currentId="install" />)

    const nav = screen.getAllByRole("navigation", { name: "Documentation guides" })[0]
    expect(within(nav).getByRole("link", { name: "Introduction" })).toHaveAttribute(
      "href",
      "/docs/intro",
    )

    const current = within(nav).getByRole("link", { name: "Installation" })
    expect(current).toHaveAttribute("href", "/docs/install")
    expect(current).toHaveAttribute("aria-current", "page")

    // Directories that do not hold the current guide stay collapsed.
    expect(within(nav).queryByRole("link", { name: "Search" })).not.toBeInTheDocument()

    await user.click(within(nav).getByRole("button", { name: /Workspace/ }))
    expect(within(nav).getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      "/docs/search",
    )
  })

  it("shows an empty state for directories without pages", async () => {
    const user = userEvent.setup()
    render(<DocsSidebar groups={groups} currentId="install" />)

    const nav = screen.getAllByRole("navigation", { name: "Documentation guides" })[0]
    await user.click(within(nav).getByRole("button", { name: /Roadmap/ }))

    expect(within(nav).getByText("No pages yet")).toBeInTheDocument()
  })

  it("shows the current guide title on the drawer trigger", () => {
    render(<DocsSidebar groups={groups} currentId="search" />)

    const trigger = screen.getByRole("button", { name: /Browse guides/ })
    expect(within(trigger).getByText("Search")).toBeInTheDocument()
  })

  it("opens the same navigation in a dialog drawer", async () => {
    const user = userEvent.setup()
    render(<DocsSidebar groups={groups} currentId="install" />)

    await user.click(screen.getByRole("button", { name: /Browse guides/ }))

    const dialog = await screen.findByRole("dialog")
    const links = within(dialog).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      expect.arrayContaining(["/docs/intro", "/docs/install"]),
    )
    expect(within(dialog).getByRole("link", { name: "Installation" })).toHaveAttribute(
      "aria-current",
      "page",
    )

    await user.click(within(dialog).getByRole("button", { name: /Workspace/ }))
    expect(within(dialog).getByRole("link", { name: "Search" })).toHaveAttribute(
      "href",
      "/docs/search",
    )
  })
})
