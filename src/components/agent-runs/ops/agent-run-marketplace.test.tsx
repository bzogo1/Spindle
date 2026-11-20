import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { AgentRunMarketplace } from "./agent-run-marketplace"
import {
  clearMarketplaceRegistry,
  isMarketplaceListingInstalled,
  MARKETPLACE_LISTINGS,
} from "@/lib/agent-runs/ops/marketplace"
import { getAgentRunTemplate } from "@/lib/agent-runs/ops/templates"

describe("AgentRunMarketplace", () => {
  beforeEach(() => {
    clearMarketplaceRegistry()
    for (const listing of MARKETPLACE_LISTINGS) {
      // ensure template registry is clean of marketplace copies
      if (isMarketplaceListingInstalled(listing.id)) {
        // no-op; registry was cleared
      }
    }
  })

  it("lists catalog entries", () => {
    render(<AgentRunMarketplace />)
    expect(screen.getByText("Release notes draft")).toBeInTheDocument()
    expect(screen.getByText("Flaky test hunter")).toBeInTheDocument()
  })

  it("installs and uninstalls a listing", async () => {
    const user = userEvent.setup()
    const listing = MARKETPLACE_LISTINGS[0]
    render(<AgentRunMarketplace />)

    const installButtons = screen.getAllByRole("button", { name: /install/i })
    await user.click(installButtons[0])

    expect(isMarketplaceListingInstalled(listing.id)).toBe(true)
    expect(getAgentRunTemplate(listing.template.id)).toBeTruthy()
    expect(screen.getByText("installed")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /uninstall/i }))
    expect(isMarketplaceListingInstalled(listing.id)).toBe(false)
    expect(getAgentRunTemplate(listing.template.id)).toBeNull()
  })

  it("filters by search query", async () => {
    const user = userEvent.setup()
    render(<AgentRunMarketplace />)
    await user.type(screen.getByLabelText("Search marketplace"), "accessibility")
    expect(screen.getByText("Accessibility audit")).toBeInTheDocument()
    expect(screen.queryByText("KPI narrative")).not.toBeInTheDocument()
  })
})
