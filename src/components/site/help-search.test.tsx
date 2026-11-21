import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { HelpArticleSummary, HelpCategoryWithCount } from "@/lib/help-center"

import { HelpSearch } from "./help-search"

const categories: HelpCategoryWithCount[] = [
  { id: "getting-started", title: "Getting started", description: "…", count: 2 },
  { id: "billing", title: "Billing", description: "…", count: 1 },
]

const articles: HelpArticleSummary[] = [
  {
    slug: "create-your-first-workspace",
    title: "Create your first workspace",
    excerpt: "Workspaces are where projects live.",
    category: "getting-started",
    categoryTitle: "Getting started",
    updatedAt: "2025-11-02",
  },
  {
    slug: "understand-plans-and-pricing",
    title: "Understand plans and pricing",
    excerpt: "What Free, Team, and Enterprise include.",
    category: "billing",
    categoryTitle: "Billing",
    updatedAt: "2025-11-15",
  },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("HelpSearch", () => {
  it("renders the initial article list without waiting for the API", () => {
    render(<HelpSearch initialArticles={articles} categories={categories} />)

    expect(screen.getByText("Create your first workspace")).toBeInTheDocument()
    expect(screen.getByText("Understand plans and pricing")).toBeInTheDocument()
    expect(screen.getByText(/2 articles/)).toBeInTheDocument()
  })

  it("fetches filtered results after typing, debounced", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, articles: [articles[0]], categories }),
    )

    render(<HelpSearch initialArticles={articles} categories={categories} />)

    await user.type(screen.getByLabelText("Search help articles"), "workspace")

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled()
    })
    const url = vi.mocked(fetch).mock.calls.at(-1)?.[0] as string
    expect(url).toContain("/api/help/articles?")
    expect(url).toContain("q=workspace")

    await waitFor(() => {
      expect(screen.getByText("Create your first workspace")).toBeInTheDocument()
      expect(screen.queryByText("Understand plans and pricing")).not.toBeInTheDocument()
    })
    expect(screen.getByText(/1 article for “workspace”/)).toBeInTheDocument()
  })

  it("sends the selected category to the API", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, articles: [articles[1]], categories }),
    )

    render(<HelpSearch initialArticles={articles} categories={categories} />)

    await user.selectOptions(screen.getByLabelText("Category"), "billing")

    await waitFor(() => {
      const url = vi.mocked(fetch).mock.calls.at(-1)?.[0] as string
      expect(url).toContain("category=billing")
    })
  })

  it("shows an error state when the API fails", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: false }, 500))

    render(<HelpSearch initialArticles={articles} categories={categories} />)

    await user.type(screen.getByLabelText("Search help articles"), "zz")

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i)
    })
  })

  it("shows a related-articles section for the selected result", async () => {
    const user = userEvent.setup()
    const related: HelpArticleSummary = {
      slug: "invite-team-members-and-roles",
      title: "Invite team members and manage roles",
      excerpt: "Add collaborators to your workspace and choose the right role.",
      category: "getting-started",
      categoryTitle: "Getting started",
      updatedAt: "2025-09-22",
    }
    const billingRelated: HelpArticleSummary = {
      slug: "update-payment-and-billing-details",
      title: "Update payment and billing details",
      excerpt: "Change your card and billing email from workspace billing settings.",
      category: "billing",
      categoryTitle: "Billing",
      updatedAt: "2025-10-27",
    }

    render(
      <HelpSearch
        initialArticles={[...articles, related, billingRelated]}
        categories={categories}
      />,
    )

    // The top result is selected by default; its same-category neighbour is related.
    const relatedSection = screen.getByRole("region", { name: "Related articles" })
    expect(within(relatedSection).getByText(/Related to/)).toHaveTextContent(
      "Create your first workspace",
    )
    const relatedLink = within(relatedSection).getByRole("link", {
      name: "Invite team members and manage roles",
    })
    expect(relatedLink).toHaveAttribute("href", "/help/invite-team-members-and-roles")

    // Hovering another result re-targets the section.
    await user.hover(screen.getByText("Understand plans and pricing"))
    await waitFor(() => {
      expect(within(relatedSection).getByText(/Related to/)).toHaveTextContent(
        "Understand plans and pricing",
      )
    })
    // Same-category articles rank first for the newly selected result.
    const links = within(relatedSection).getAllByRole("link")
    expect(links[0]).toHaveTextContent("Update payment and billing details")
  })

  it("shows an empty state with a support link when nothing matches", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, articles: [], categories }))

    render(<HelpSearch initialArticles={articles} categories={categories} />)

    await user.type(screen.getByLabelText("Search help articles"), "zzz")

    await waitFor(() => {
      expect(screen.getByText(/No matches/)).toBeInTheDocument()
    })
    expect(screen.getByRole("link", { name: /contact support/i })).toHaveAttribute(
      "href",
      "/contact",
    )
  })
})
