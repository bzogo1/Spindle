import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { marketplaceTemplates } from "@/lib/automation-graph"

import { MarketplacePanel } from "./marketplace-panel"

describe("MarketplacePanel", () => {
  it("lists templates with ratings and installs", () => {
    render(<MarketplacePanel onInstall={vi.fn()} />)
    expect(screen.getByText("Template marketplace")).toBeInTheDocument()
    for (const template of marketplaceTemplates().slice(0, 3)) {
      expect(screen.getByText(template.name)).toBeInTheDocument()
    }
    expect(screen.getAllByText(/installs/).length).toBeGreaterThan(0)
  })

  it("filters by search query", async () => {
    const user = userEvent.setup()
    render(<MarketplacePanel onInstall={vi.fn()} />)

    await user.type(screen.getByLabelText("Search templates"), "triage")
    expect(screen.getByText("Event triage")).toBeInTheDocument()
    expect(screen.queryByText("CSV cleanup")).not.toBeInTheDocument()
  })

  it("filters by category", async () => {
    const user = userEvent.setup()
    render(<MarketplacePanel onInstall={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Alerting" }))
    expect(screen.getByText("File change alert")).toBeInTheDocument()
    expect(screen.getByText("Error alert")).toBeInTheDocument()
    expect(screen.queryByText("Daily digest")).not.toBeInTheDocument()
  })

  it("previews a template's nodes and installs it", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    render(<MarketplacePanel onInstall={onInstall} />)

    const cards = screen.getAllByRole("button", { name: "Preview" })
    await user.click(cards[0])
    expect(screen.getByText(/nodes in this template/)).toBeInTheDocument()

    await user.click(screen.getAllByRole("button", { name: "Install template" })[0])
    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onInstall.mock.calls[0][0].build().nodes.length).toBeGreaterThan(0)
  })

  it("shows an empty state for unmatched searches", async () => {
    const user = userEvent.setup()
    render(<MarketplacePanel onInstall={vi.fn()} />)
    await user.type(screen.getByLabelText("Search templates"), "zzzzzz")
    expect(screen.getByText("No templates match your search.")).toBeInTheDocument()
  })
})
