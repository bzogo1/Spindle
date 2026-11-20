import { render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DocGuide, DocsNavSection } from "@/lib/docs"

import { DocsShell } from "./docs-shell"

const { getGuide, getDocsPager, getDocsNavigation, getGuideHeadings } = vi.hoisted(() => ({
  getGuide: vi.fn(),
  getDocsPager: vi.fn(),
  getDocsNavigation: vi.fn(),
  getGuideHeadings: vi.fn(),
}))

vi.mock("@/lib/docs", () => ({
  getGuide,
  getDocsPager,
  getDocsNavigation,
  getGuideHeadings,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

function makeGuide(id: string, title: string, order: number): DocGuide {
  return {
    id,
    eyebrow: "Start here",
    title,
    description: `${title} description.`,
    section: "Getting started",
    order,
    updated: "2025-01-01",
    draft: false,
    headings: [],
  }
}

const guide: DocGuide = {
  ...makeGuide("intro", "Introduction", 1),
  headings: [
    { id: "intro-why", title: "Why Spindle" },
    { id: "intro-next", title: "What's next" },
  ],
}

const groups: DocsNavSection[] = [
  {
    title: "Getting started",
    guides: [
      { id: "intro", title: "Introduction" },
      { id: "install", title: "Installation" },
    ],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  // DocsOnThisPage observes the article headings; the stub never reports
  // intersections, which leaves the first heading active.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  getGuide.mockReturnValue(guide)
  getDocsPager.mockReturnValue({
    previous: null,
    next: makeGuide("install", "Installation", 2),
    position: 1,
    total: 3,
  })
  getDocsNavigation.mockReturnValue(groups)
  getGuideHeadings.mockReturnValue(guide.headings)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DocsShell", () => {
  it("renders breadcrumbs, the article slot, pager, sidebar and on-this-page nav", () => {
    render(
      <DocsShell id="intro">
        <h2 data-doc-heading id="intro-why">
          Why Spindle
        </h2>
        <p>Article body</p>
      </DocsShell>,
    )

    const breadcrumbs = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(breadcrumbs).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs")
    expect(within(breadcrumbs).getByText("Getting started")).toBeInTheDocument()
    expect(within(breadcrumbs).getByText("Introduction")).toBeInTheDocument()

    const article = document.getElementById("doc-article")
    expect(article).toHaveTextContent("Article body")
    expect(article?.querySelector("[data-doc-heading]")).not.toBeNull()

    const pager = screen.getByRole("navigation", { name: "Guide pagination" })
    expect(within(pager).getByText("Guide 1 of 3")).toBeInTheDocument()
    // First guide has no previous link, so a spacer keeps the layout balanced.
    expect(within(pager).queryByRole("link", { name: /Previous/ })).not.toBeInTheDocument()
    expect(within(pager).getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/docs/install",
    )

    const sidebar = screen.getAllByRole("navigation", { name: "Documentation guides" })[0]
    expect(within(sidebar).getByRole("link", { name: "Installation" })).toHaveAttribute(
      "href",
      "/docs/install",
    )

    const onThisPage = screen.getByRole("navigation", { name: "On this page" })
    expect(within(onThisPage).getByRole("link", { name: "Why Spindle" })).toHaveAttribute(
      "href",
      "#intro-why",
    )
    expect(within(onThisPage).getByRole("link", { name: "What's next" })).toHaveAttribute(
      "href",
      "#intro-next",
    )
  })

  it("links to the previous guide when the pager has one", () => {
    getDocsPager.mockReturnValue({
      previous: makeGuide("welcome", "Welcome", 0),
      next: null,
      position: 3,
      total: 3,
    })

    render(<DocsShell id="intro">Body</DocsShell>)

    const pager = screen.getByRole("navigation", { name: "Guide pagination" })
    expect(within(pager).getByText("Guide 3 of 3")).toBeInTheDocument()
    expect(within(pager).getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/docs/welcome",
    )
    expect(within(pager).queryByRole("link", { name: /Next/ })).not.toBeInTheDocument()
  })

  it("renders nothing for an unknown guide id", () => {
    getGuide.mockReturnValue(undefined)

    const { container } = render(<DocsShell id="missing">Body</DocsShell>)

    expect(container).toBeEmptyDOMElement()
    expect(getDocsNavigation).not.toHaveBeenCalled()
    expect(getGuideHeadings).not.toHaveBeenCalled()
  })
})
