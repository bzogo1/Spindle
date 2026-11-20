"use client"

import { useMemo, useState } from "react"
import { Download, Store, Trash2 } from "lucide-react"

import {
  browseMarketplaceListings,
  installMarketplaceListing,
  isMarketplaceListingInstalled,
  marketplaceCategories,
  uninstallMarketplaceListing,
  type MarketplaceListing,
} from "@/lib/agent-runs/ops/marketplace"

/**
 * Local marketplace browser for agent run templates. Listings come from the
 * mock catalog; install/uninstall persist to the localStorage registry and
 * register the template for instantiation.
 */
export function AgentRunMarketplace({ onInstalledChange }: { onInstalledChange?: () => void }) {
  const [category, setCategory] = useState("all")
  const [query, setQuery] = useState("")
  const [installedTick, setInstalledTick] = useState(0)

  const categories = useMemo(() => marketplaceCategories(), [])
  // installedTick is a refresh trigger: bumping it re-reads the
  // localStorage-backed install registry inside browseMarketplaceListings.
  const listings = useMemo(
    () => browseMarketplaceListings({ category, query }),
    [category, query, installedTick],
  )

  const refresh = () => {
    setInstalledTick((t) => t + 1)
    onInstalledChange?.()
  }

  const install = (listing: MarketplaceListing) => {
    installMarketplaceListing(listing)
    refresh()
  }

  const uninstall = (listingId: string) => {
    uninstallMarketplaceListing(listingId)
    refresh()
  }

  return (
    <section className="app-panel" aria-labelledby="mkt-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="mkt-heading">
            <Store aria-hidden="true" className="app-panel-icon" /> Template marketplace
          </h2>
          <p>Browse and install run templates. Installs are stored locally.</p>
        </div>
      </div>

      <div className="app-mkt-filters">
        <input
          type="search"
          className="app-mkt-search"
          placeholder="Search templates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search marketplace"
        />
        <div className="app-mkt-cats" role="tablist" aria-label="Categories">
          {["all", ...categories].map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={category === cat}
              className={`app-mkt-cat${category === cat ? "is-active" : ""}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {listings.length === 0 ? (
        <p className="app-runlog-empty-steps">No listings match this filter.</p>
      ) : (
        <ul className="app-mkt-list">
          {listings.map((listing) => {
            const installed = isMarketplaceListingInstalled(listing.id)
            return (
              <li key={listing.id} className="app-mkt-item">
                <div className="app-mkt-item-main">
                  <div className="app-tpl-card-head">
                    <strong>{listing.name}</strong>
                    <span className="app-badge">v{listing.version}</span>
                    <span className="app-badge">{listing.category}</span>
                    {listing.featured ? (
                      <span className="app-badge is-running">featured</span>
                    ) : null}
                    {installed ? <span className="app-badge is-done">installed</span> : null}
                  </div>
                  <p className="app-tpl-card-desc">{listing.description}</p>
                  <p className="app-mkt-meta">
                    by {listing.author} · {listing.installs.toLocaleString()} installs
                  </p>
                </div>
                <div className="app-mkt-item-actions">
                  {installed ? (
                    <button
                      type="button"
                      className="fm-btn fm-btn--danger"
                      onClick={() => uninstall(listing.id)}
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" /> Uninstall
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="fm-btn fm-btn--solid"
                      onClick={() => install(listing)}
                    >
                      <Download aria-hidden="true" className="size-3.5" /> Install
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
