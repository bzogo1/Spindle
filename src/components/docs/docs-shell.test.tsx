import { render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DocGuide, DocsNavSection } from "@/lib/docs"

import { DocsShell } from "./docs-shell"

const { getGuide, getDocsPager, getGuideQuickLinks, getDocsNavigation, getGuideHeadings } =
  vi.hoisted(() => ({
    getGuide: vi.fn(),
    getDocsPager: vi.fn(),
    getGuideQuickLinks: vi.fn(),
    getDocsNavigation: vi.fn(),
    getGuideHeadings: vi.fn(),
  }))

vi.mock("@/lib/docs", () => ({
  getGuide,
  getDocsPager,
  getGuideQuickLinks,
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
  getGuideQuickLinks.mockReturnValue([
    makeGuide("install", "Installation", 2),
    makeGuide("faq", "FAQ", 9),
  ])
  getDocsNavigation.mockReturnValue(groups)
  getGuideHeadings.mockReturnValue(guide.headings)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DocsShell", () => {
  it("renders breadcrumbs, the article slot, quick links, sidebar and on-this-page nav", () => {
    render(
      <DocsShell id="intro">
        <h2 data-doc-heading id="intro-why">
          Why Spindle
        </h2>
        <p>Article body</p>
      </DocsShell>,
    )

    const breadcrumbs = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(breadcrumbs).queryByRole("link", { name: "Docs" })).not.toBeInTheDocument()
    expect(within(breadcrumbs).getByText("Getting started")).toBeInTheDocument()
    expect(within(breadcrumbs).getByText("Introduction")).toBeInTheDocument()

    const article = document.getElementById("doc-article")
    expect(article).toHaveTextContent("Article body")
    expect(article?.querySelector("[data-doc-heading]")).not.toBeNull()

    const quickLinks = screen.getByRole("navigation", { name: "Related guides" })
    expect(within(quickLinks).getByText("Guide 1 of 3")).toBeInTheDocument()
    const links = within(quickLinks).getAllByRole("link")
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute("href", "/docs/install")
    expect(links[0]).toHaveTextContent("Installation")
    expect(links[1]).toHaveAttribute("href", "/docs/faq")

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

  it("omits the quick links nav when there is nothing to link to", () => {
    getGuideQuickLinks.mockReturnValue([])

    render(<DocsShell id="intro">Body</DocsShell>)

    expect(screen.queryByRole("navigation", { name: "Related guides" })).not.toBeInTheDocument()
  })

  it("renders nothing for an unknown guide id", () => {
    getGuide.mockReturnValue(undefined)

    const { container } = render(<DocsShell id="missing">Body</DocsShell>)

    expect(container).toBeEmptyDOMElement()
    expect(getDocsNavigation).not.toHaveBeenCalled()
    expect(getGuideHeadings).not.toHaveBeenCalled()
  })
})
