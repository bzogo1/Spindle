import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { SearchAutocomplete, type AutocompleteEntry } from "./search-autocomplete"
import { SearchHighlight, queryTokens } from "./highlight"

function entry(
  partial: Partial<AutocompleteEntry> & Pick<AutocompleteEntry, "id" | "title">,
): AutocompleteEntry {
  return partial
}

function Harness({
  items,
  suggestions,
  onSelect = vi.fn(),
  onSuggestionSelect,
}: {
  items: AutocompleteEntry[]
  suggestions?: Parameters<typeof SearchAutocomplete>[0]["suggestions"]
  onSelect?: (entry: AutocompleteEntry) => void
  onSuggestionSelect?: (query: string) => void
}) {
  const [query, setQuery] = useState("")
  // Simulate a real caller: the parent filters/ranks items for the query.
  const q = query.trim().toLowerCase()
  const visible = q
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (item.subtitle ?? "").toLowerCase().includes(q) ||
          (item.keywords ?? "").toLowerCase().includes(q),
      )
    : items
  return (
    <SearchAutocomplete
      query={query}
      onQueryChange={setQuery}
      items={visible}
      onSelect={onSelect}
      suggestions={suggestions}
      onSuggestionSelect={onSuggestionSelect}
      ariaLabel="Test search"
      groupOrder={["Pages", "Docs"]}
    />
  )
}

describe("SearchHighlight", () => {
  it("wraps query token matches in <mark>", () => {
    render(<SearchHighlight text="Tide Pool Survey" query="tide survey" />)
    const marks = screen.getAllByText(/tide|survey/i)
    expect(marks.length).toBeGreaterThan(0)
    expect(document.querySelectorAll("mark").length).toBe(2)
  })

  it("renders plain text for empty queries", () => {
    const { container } = render(<SearchHighlight text="Plain" query="" />)
    expect(container.querySelector("mark")).toBeNull()
    expect(container).toHaveTextContent("Plain")
  })

  it("queryTokens dedupes and drops 1-char tokens", () => {
    expect(queryTokens("a tide tide b")).toEqual(["tide"])
  })
})

describe("SearchAutocomplete", () => {
  const items = [
    entry({ id: "p1", title: "Dashboard", subtitle: "Overview page", group: "Pages" }),
    entry({ id: "d1", title: "Dashboard guide", subtitle: "Docs section", group: "Docs" }),
    entry({ id: "p2", title: "Settings", group: "Pages" }),
  ]

  it("groups entries and highlights matches", async () => {
    const user = userEvent.setup()
    render(<Harness items={items} />)

    const input = screen.getByRole("combobox", { name: "Test search" })
    await user.type(input, "dash")

    const options = await screen.findAllByRole("option")
    expect(options).toHaveLength(2)
    // Group headings render for Pages and Docs.
    expect(screen.getByText("Pages")).toBeInTheDocument()
    expect(screen.getByText("Docs")).toBeInTheDocument()
    // Matched text is highlighted.
    expect(document.querySelectorAll("mark").length).toBeGreaterThan(0)
  })

  it("navigates with arrow keys and selects with Enter", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Harness items={items} onSelect={onSelect} />)

    const input = screen.getByRole("combobox", { name: "Test search" })
    await user.click(input)

    const options = screen.getAllByRole("option")
    expect(options[0]).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{ArrowDown}")
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{ArrowUp}")
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0]![0].title).toBe("Dashboard")
  })

  it("Escape closes the dropdown and calls onRequestClose", async () => {
    const user = userEvent.setup()
    const onRequestClose = vi.fn()
    function Closable() {
      const [query, setQuery] = useState("")
      return (
        <SearchAutocomplete
          query={query}
          onQueryChange={setQuery}
          items={items}
          onSelect={vi.fn()}
          onRequestClose={onRequestClose}
          ariaLabel="Test search"
        />
      )
    }
    render(<Closable />)

    const input = screen.getByRole("combobox", { name: "Test search" })
    await user.click(input)
    expect(await screen.findAllByRole("option")).not.toHaveLength(0)

    await user.keyboard("{Escape}")
    expect(onRequestClose).toHaveBeenCalled()
    expect(screen.queryAllByRole("option")).toHaveLength(0)
  })

  it("renders did-you-mean chips and applies them on click", async () => {
    const user = userEvent.setup()
    const onSuggestionSelect = vi.fn()
    render(
      <Harness
        items={[]}
        suggestions={{ didYouMean: ["Settings"], related: ["Billing"], trending: ["Home"] }}
        onSuggestionSelect={onSuggestionSelect}
      />,
    )

    const input = screen.getByRole("combobox", { name: "Test search" })
    await user.type(input, "seting")

    const chip = await screen.findByRole("button", { name: "Settings" })
    await user.click(chip)
    expect(onSuggestionSelect).toHaveBeenCalledWith("Settings")
    expect(input).toHaveValue("Settings")
  })

  it("shows trending chips for an empty query", async () => {
    const user = userEvent.setup()
    render(<Harness items={items} suggestions={{ trending: ["Dashboard"] }} />)

    const input = screen.getByRole("combobox", { name: "Test search" })
    await user.click(input)

    expect(await screen.findByText("Trending:")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument()
  })

  it("Enter with no rows applies the top did-you-mean suggestion", async () => {
    const user = userEvent.setup()
    const onSuggestionSelect = vi.fn()
    render(
      <Harness
        items={[]}
        suggestions={{ didYouMean: ["Settings"] }}
        onSuggestionSelect={onSuggestionSelect}
      />,
    )

    const input = screen.getByRole("combobox", { name: "Test search" })
    await user.type(input, "seting")
    await user.keyboard("{Enter}")

    expect(onSuggestionSelect).toHaveBeenCalledWith("Settings")
  })
})
