import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  browseMarketplaceListings,
  clearMarketplaceRegistry,
  installMarketplaceListing,
  isMarketplaceListingInstalled,
  listInstalledMarketplaceTemplates,
  loadMarketplaceRegistry,
  marketplaceCategories,
  MARKETPLACE_LISTINGS,
  uninstallMarketplaceListing,
} from "./marketplace"
import { getAgentRunTemplate, instantiateRunFromTemplate } from "./templates"

describe("marketplace", () => {
  beforeEach(() => {
    clearMarketplaceRegistry()
    // Reset template registry side-effects by uninstalling leftovers.
    for (const listing of MARKETPLACE_LISTINGS) {
      if (getAgentRunTemplate(listing.template.id)?.source?.startsWith("marketplace:")) {
        // already handled by uninstall below if installed
      }
    }
  })

  it("lists mock catalog entries with categories", () => {
    expect(MARKETPLACE_LISTINGS.length).toBeGreaterThanOrEqual(3)
    const cats = marketplaceCategories()
    expect(cats).toContain("engineering")
    expect(cats).toContain("docs")
  })

  it("browses with category and query filters", () => {
    const eng = browseMarketplaceListings({ category: "engineering" })
    expect(eng.every((l) => l.category === "engineering")).toBe(true)
    const docs = browseMarketplaceListings({ query: "release notes" })
    expect(docs.some((l) => l.id === "mkt.release-notes")).toBe(true)
    expect(browseMarketplaceListings({ query: "zzzz-no-match" })).toEqual([])
  })

  it("installs a listing into localStorage and registers its template", () => {
    const listing = MARKETPLACE_LISTINGS[0]
    const result = installMarketplaceListing(listing, { now: new Date("2026-01-01T00:00:00Z") })
    expect(result.ok).toBe(true)
    expect(isMarketplaceListingInstalled(listing.id)).toBe(true)
    expect(getAgentRunTemplate(listing.template.id)).toBeTruthy()
    expect(listInstalledMarketplaceTemplates().map((t) => t.id)).toContain(listing.template.id)

    const registry = loadMarketplaceRegistry()
    expect(registry.installedAt[listing.id]).toBe("2026-01-01T00:00:00.000Z")

    // Instantiation works off the installed template.
    const run = instantiateRunFromTemplate(listing.template)
    expect(run.templateId).toBe(listing.template.id)
    expect(run.prompt).toBe(listing.template.prompt)
  })

  it("install is idempotent", () => {
    const listing = MARKETPLACE_LISTINGS[0]
    expect(installMarketplaceListing(listing).ok).toBe(true)
    expect(installMarketplaceListing(listing).ok).toBe(true)
    expect(Object.keys(loadMarketplaceRegistry().installed)).toHaveLength(1)
  })

  it("uninstalls and removes the template registration", () => {
    const listing = MARKETPLACE_LISTINGS[0]
    installMarketplaceListing(listing)
    expect(uninstallMarketplaceListing(listing.id)).toBe(true)
    expect(isMarketplaceListingInstalled(listing.id)).toBe(false)
    expect(getAgentRunTemplate(listing.template.id)).toBeNull()
    expect(uninstallMarketplaceListing(listing.id)).toBe(false)
    expect(uninstallMarketplaceListing("never-installed")).toBe(false)
  })

  it("browse can exclude installed listings", () => {
    const listing = MARKETPLACE_LISTINGS[0]
    installMarketplaceListing(listing)
    const remaining = browseMarketplaceListings({ includeInstalled: false })
    expect(remaining.some((l) => l.id === listing.id)).toBe(false)
    clearMarketplaceRegistry()
  })

  it("rehydrates installed templates after a module reload", async () => {
    const listing = MARKETPLACE_LISTINGS[0]
    installMarketplaceListing(listing)
    expect(isMarketplaceListingInstalled(listing.id)).toBe(true)

    // Simulate a fresh page load: localStorage persists, module state resets.
    vi.resetModules()
    const freshMarketplace = await import("./marketplace")
    const freshTemplates = await import("./templates")

    // The template registry starts empty of marketplace copies…
    expect(freshTemplates.getAgentRunTemplate(listing.template.id)).toBeNull()
    // …but loading the registry re-registers it from the persisted install.
    const installed = freshMarketplace.listInstalledMarketplaceTemplates()
    expect(installed.map((t) => t.id)).toContain(listing.template.id)
    expect(freshTemplates.getAgentRunTemplate(listing.template.id)).toBeTruthy()
    const run = freshTemplates.instantiateRunFromTemplate(listing.template)
    expect(run.templateId).toBe(listing.template.id)

    clearMarketplaceRegistry()
    vi.resetModules()
  })
})
