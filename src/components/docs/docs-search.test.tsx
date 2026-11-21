import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocsSearch } from "@/components/docs/docs-search"
import { QUERY_LOG_STORAGE_KEY, recordSearchQuery } from "@/lib/search/suggestions"

const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

beforeEach(() => {
  push.mockReset()
  window.history.replaceState(null, "", "/docs")
  window.localStorage.removeItem(QUERY_LOG_STORAGE_KEY)
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

    expect(await screen.findAllByRole("option")).toHaveLength(10)

    await user.type(input, "kubernetes")

    expect(screen.getByText(/No matches for/)).toBeInTheDocument()
    expect(screen.queryAllByRole("option")).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: "Reset search" }))

    expect(input).toHaveValue("")
    expect(await screen.findAllByRole("option")).toHaveLength(10)
  })

  it("suggests a spelling correction when a query has no matches", async () => {
    const user = userEvent.setup()
    render(<DocsSearch />)

    const input = screen.getByRole("combobox", { name: "Search the docs" })
    await user.click(input)
    await user.type(input, "collaboartion")

    expect(await screen.findByText(/Did you mean:/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Collaboration" }))

    expect(input).toHaveValue("Collaboration")
    expect(await screen.findAllByRole("option")).not.toHaveLength(0)
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

  it("shows previous searches with timestamps and refills the input", async () => {
    recordSearchQuery("local search")
    recordSearchQuery("agent setup")
    const user = userEvent.setup()
    render(<DocsSearch />)

    const input = screen.getByRole("combobox", { name: "Search the docs" })
    await user.click(input)

    expect(await screen.findByText("Recent searches")).toBeInTheDocument()
    const historyItems = screen.getAllByRole("button", { name: /search|setup/ })
    expect(historyItems.length).toBeGreaterThanOrEqual(2)
    // Timestamps render inside a <time> element.
    expect(document.querySelector(".doc-search-history time")).not.toBeNull()

    await user.click(screen.getByRole("button", { name: /agent setup/ }))

    expect(input).toHaveValue("agent setup")
    // The history section hides once the input has a query again.
    expect(screen.queryByText("Recent searches")).not.toBeInTheDocument()
  })

  it("hides the history section once a query is typed", async () => {
    recordSearchQuery("local search")
    const user = userEvent.setup()
    render(<DocsSearch />)

    const input = screen.getByRole("combobox", { name: "Search the docs" })
    await user.click(input)
    expect(await screen.findByText("Recent searches")).toBeInTheDocument()

    await user.type(input, "guide")

    expect(screen.queryByText("Recent searches")).not.toBeInTheDocument()
  })
})
