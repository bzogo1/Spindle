import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { SearchFilters } from "@/lib/search/filters"
import { computeSearchFacets } from "@/lib/search/facets"
import type { SearchItem } from "@/lib/search"
import { SearchFacetList, SearchFilterBar } from "./search-filter-bar"

function item(partial: Partial<SearchItem> & Pick<SearchItem, "id" | "title">): SearchItem {
  return { group: "Pages", ...partial }
}

describe("SearchFilterBar", () => {
  it("toggles type checkboxes", async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(
      <SearchFilterBar
        types={[
          { value: "page", count: 3 },
          { value: "doc", count: 2 },
        ]}
        filters={{}}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.click(screen.getByRole("checkbox", { name: /page/i }))
    expect(onFiltersChange).toHaveBeenCalledWith({ types: ["page"] })
  })

  it("sets section and updated filters via selects", async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(
      <SearchFilterBar
        sections={[{ value: "Guides" }]}
        filters={{}}
        onFiltersChange={onFiltersChange}
      />,
    )

    await user.selectOptions(screen.getByLabelText("Section"), "Guides")
    expect(onFiltersChange).toHaveBeenCalledWith({ sections: ["Guides"] })

    await user.selectOptions(screen.getByLabelText("Updated"), "30")
    const call = onFiltersChange.mock.calls.at(-1)![0] as SearchFilters
    expect(call.updatedAfter).toBeGreaterThan(0)
    expect(call.updatedAfter!).toBeLessThanOrEqual(Date.now())
  })
})

describe("SearchFacetList", () => {
  const items: SearchItem[] = [
    item({ id: "page:/a", title: "A", type: "page", section: "Product", tags: ["x"] }),
    item({ id: "doc:g:s", title: "B", type: "doc", section: "Guides", tags: ["y"] }),
    item({ id: "doc:g:t", title: "C", type: "doc", section: "Guides", tags: ["x"] }),
  ]
  const facets = computeSearchFacets(items)

  it("renders facet counts and toggles filters on click", async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(<SearchFacetList facets={facets} filters={{}} onFiltersChange={onFiltersChange} />)

    // Type facet: doc count is 2.
    const docButton = screen.getByRole("button", { name: /doc\s*2/ })
    expect(docButton).toHaveAttribute("aria-pressed", "false")
    await user.click(docButton)
    expect(onFiltersChange).toHaveBeenCalledWith({ types: ["doc"] })
  })

  it("marks active facets and clears them on second click", async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(
      <SearchFacetList
        facets={facets}
        filters={{ types: ["doc"] }}
        onFiltersChange={onFiltersChange}
      />,
    )

    const docButton = screen.getByRole("button", { name: /doc\s*2/ })
    expect(docButton).toHaveAttribute("aria-pressed", "true")
    await user.click(docButton)
    expect(onFiltersChange).toHaveBeenCalledWith({ types: undefined })
  })

  it("renders nothing when all facet lists are empty", () => {
    const { container } = render(
      <SearchFacetList
        facets={{ type: [], section: [], tag: [] }}
        filters={{}}
        onFiltersChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
