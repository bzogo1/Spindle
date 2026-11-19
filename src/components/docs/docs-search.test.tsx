import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocsSearch } from "@/components/docs/docs-search"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

beforeEach(() => {
  push.mockReset()
  window.history.replaceState(null, "", "/docs")
})

describe("DocsSearch", () => {
  it("finds a body-only term and opens the matching section", async () => {
    const user = userEvent.setup()
    render(<DocsSearch />)

    const input = screen.getByRole("combobox", { name: "Search the docs" })
    await user.click(input)
    await user.type(input, "SearXNG")

    const options = await screen.findAllByRole("option")
    expect(options[0]).toHaveTextContent("Two search modes")
    expect(options[0]).toHaveTextContent("Local search")

    await user.keyboard("{Enter}")

    expect(push).toHaveBeenCalledWith("/docs/search#search-two-search-modes")
  })

  it("shows the guide list before a query and a reset for no results", async () => {
    const user = userEvent.setup()
    render(<DocsSearch />)

    const input = screen.getByRole("combobox", { name: "Search the docs" })
    await user.click(input)

    expect(await screen.findAllByRole("option")).toHaveLength(9)

    await user.type(input, "kubernetes")

    expect(screen.getByText(/No matches for/)).toBeInTheDocument()
    expect(screen.queryAllByRole("option")).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: "Reset search" }))

    expect(input).toHaveValue("")
    expect(await screen.findAllByRole("option")).toHaveLength(9)
  })

  it("moves through results with the arrow keys", async () => {
    const user = userEvent.setup()
    render(<DocsSearch />)

    const input = screen.getByRole("combobox", { name: "Search the docs" })
    await user.click(input)
    await user.type(input, "search")

    const options = await screen.findAllByRole("option")
    expect(options[0]).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{ArrowDown}")

    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true")
  })
})
