/**
 * Agent run marketplace — a local catalog of installable run templates.
 *
 * The "remote" side is a static, mock featured list (`MARKETPLACE_LISTINGS`)
 * standing in for a server catalog. Installing a listing copies its template
 * into a localStorage-backed registry (`spindle.agent-runs.marketplace.v1`)
 * and registers it with the template registry so instantiated runs pick it
 * up. Uninstall removes it from both. All storage access is SSR-safe.
 */

import {
  getAgentRunTemplate,
  registerAgentRunTemplate,
  unregisterAgentRunTemplate,
  type AgentRunTemplate,
} from "./templates"
import { storageGetJson, storageSetJson, storageRemove } from "./storage"

export const MARKETPLACE_STORAGE_KEY = "spindle.agent-runs.marketplace.v1"

export interface MarketplaceListing {
  id: string
  name: string
  version: number
  description: string
  category: string
  author: string
  /** Rough install count shown in the UI. */
  installs: number
  featured?: boolean
  template: AgentRunTemplate
}

/** Mock remote catalog — the featured listings shown on first browse. */
export const MARKETPLACE_LISTINGS: readonly MarketplaceListing[] = [
  {
    id: "mkt.release-notes",
    name: "Release notes draft",
    version: 1,
    description: "Draft user-facing release notes from a changelog or merged PRs.",
    category: "docs",
    author: "spindle-labs",
    installs: 1284,
    featured: true,
    template: {
      id: "tpl.mkt.release-notes",
      name: "Release notes draft",
      version: 1,
      description: "Draft user-facing release notes from a changelog or merged PRs.",
      category: "docs",
      prompt:
        "Draft release notes for this change set. Group by user-facing impact, " +
        "skip internal refactors, and end with upgrade/rollback notes.",
      config: { model: "writer-small", maxSteps: 8, tags: ["docs", "release"] },
      source: "marketplace:mkt.release-notes",
    },
  },
  {
    id: "mkt.flake-hunter",
    name: "Flaky test hunter",
    version: 3,
    description: "Analyze a failing test log and rank likely flake causes.",
    category: "engineering",
    author: "ci-tools",
    installs: 947,
    featured: true,
    template: {
      id: "tpl.mkt.flake-hunter",
      name: "Flaky test hunter",
      version: 3,
      description: "Analyze a failing test log and rank likely flake causes.",
      category: "engineering",
      prompt:
        "Given this test failure log, rank the most likely causes of flakiness " +
        "(timing, ordering, environment, data) and suggest the cheapest fix for each.",
      config: { model: "reviewer-large", maxSteps: 10, tags: ["testing", "ci"] },
      source: "marketplace:mkt.flake-hunter",
    },
  },
  {
    id: "mkt.kpi-narrative",
    name: "KPI narrative",
    version: 1,
    description: "Turn a metrics snapshot into a weekly KPI narrative.",
    category: "data",
    author: "spindle-labs",
    installs: 412,
    template: {
      id: "tpl.mkt.kpi-narrative",
      name: "KPI narrative",
      version: 1,
      description: "Turn a metrics snapshot into a weekly KPI narrative.",
      category: "data",
      prompt:
        "Write a weekly KPI narrative from this metrics snapshot. Lead with " +
        "the headline movement, then drivers, risks, and next-week watch items.",
      config: { model: "analyst-medium", maxSteps: 8, tags: ["data", "reporting"] },
      source: "marketplace:mkt.kpi-narrative",
    },
  },
  {
    id: "mkt.accessibility-audit",
    name: "Accessibility audit",
    version: 2,
    description: "Check a UI change against common WCAG failure patterns.",
    category: "engineering",
    author: "a11y-guild",
    installs: 689,
    featured: true,
    template: {
      id: "tpl.mkt.accessibility-audit",
      name: "Accessibility audit",
      version: 2,
      description: "Check a UI change against common WCAG failure patterns.",
      category: "engineering",
      prompt:
        "Audit this UI change for WCAG 2.2 AA issues: contrast, focus order, " +
        "labels, keyboard traps, and ARIA misuse. Cite the criterion for each finding.",
      config: { model: "reviewer-large", maxSteps: 12, tags: ["a11y", "engineering"] },
      source: "marketplace:mkt.accessibility-audit",
    },
  },
]

interface MarketplaceRegistry {
  version: 1
  /** listing id -> template id of the installed copy */
  installed: Record<string, string>
  installedAt: Record<string, string>
}

function emptyRegistry(): MarketplaceRegistry {
  return { version: 1, installed: {}, installedAt: {} }
}

/**
 * Re-register installed templates after a reload. The template registry in
 * `templates.ts` is a module-level Map — it starts empty of marketplace
 * copies on every fresh page load, while the install list persists in
 * localStorage. For each persisted install, look up its catalog listing and
 * register the template copy again so `listInstalledMarketplaceTemplates`
 * and `instantiateRunFromTemplate` keep working across sessions.
 * Listings no longer present in the catalog cannot be re-registered; their
 * install markers are left in place (the template simply stays unresolvable).
 */
function rehydrateInstalledTemplates(registry: MarketplaceRegistry): void {
  for (const [listingId, templateId] of Object.entries(registry.installed)) {
    if (getAgentRunTemplate(templateId)) continue
    const listing = MARKETPLACE_LISTINGS.find((l) => l.id === listingId)
    if (listing) registerAgentRunTemplate(listing.template)
  }
}

export function loadMarketplaceRegistry(): MarketplaceRegistry {
  const stored = storageGetJson<Partial<MarketplaceRegistry>>(MARKETPLACE_STORAGE_KEY, {})
  if (stored.version !== 1 || typeof stored.installed !== "object" || stored.installed === null) {
    return emptyRegistry()
  }
  const registry: MarketplaceRegistry = {
    version: 1,
    installed: { ...stored.installed },
    installedAt:
      typeof stored.installedAt === "object" && stored.installedAt ? { ...stored.installedAt } : {},
  }
  rehydrateInstalledTemplates(registry)
  return registry
}

function saveMarketplaceRegistry(registry: MarketplaceRegistry): boolean {
  return storageSetJson(MARKETPLACE_STORAGE_KEY, registry)
}

export function isMarketplaceListingInstalled(listingId: string): boolean {
  return listingId in loadMarketplaceRegistry().installed
}

/** All installed templates (marketplace copies), in registry order. */
export function listInstalledMarketplaceTemplates(): AgentRunTemplate[] {
  const registry = loadMarketplaceRegistry()
  const templates: AgentRunTemplate[] = []
  for (const listingId of Object.keys(registry.installed)) {
    const template = getAgentRunTemplate(registry.installed[listingId])
    if (template) templates.push(template)
  }
  return templates
}

export interface MarketplaceBrowseOptions {
  category?: string
  query?: string
  /** Include already-installed listings (default true). */
  includeInstalled?: boolean
}

export function browseMarketplaceListings(
  options: MarketplaceBrowseOptions = {},
): MarketplaceListing[] {
  const registry = loadMarketplaceRegistry()
  const query = options.query?.trim().toLowerCase()
  return MARKETPLACE_LISTINGS.filter((listing) => {
    if (options.category && options.category !== "all" && listing.category !== options.category) {
      return false
    }
    if (options.includeInstalled === false && listing.id in registry.installed) return false
    if (query) {
      const haystack =
        `${listing.name} ${listing.description} ${listing.author} ${listing.category}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

/** Distinct categories across the catalog (plus "all"). */
export function marketplaceCategories(): string[] {
  return [...new Set(MARKETPLACE_LISTINGS.map((listing) => listing.category))].sort()
}

export interface InstallResult {
  ok: boolean
  /** Reason install failed, when `ok` is false. */
  error?: string
}

/**
 * Install a marketplace listing: persist to the localStorage registry and
 * register the template copy so `instantiateRunFromTemplate` can use it.
 */
export function installMarketplaceListing(
  listing: MarketplaceListing,
  options: { now?: Date } = {},
): InstallResult {
  const registry = loadMarketplaceRegistry()
  if (listing.id in registry.installed) return { ok: true }
  registry.installed[listing.id] = listing.template.id
  registry.installedAt[listing.id] = (options.now ?? new Date()).toISOString()
  if (!saveMarketplaceRegistry(registry)) {
    return { ok: false, error: "Could not persist the marketplace registry (storage unavailable)." }
  }
  registerAgentRunTemplate(listing.template)
  return { ok: true }
}

export function uninstallMarketplaceListing(listingId: string): boolean {
  const registry = loadMarketplaceRegistry()
  const templateId = registry.installed[listingId]
  if (!templateId) return false
  delete registry.installed[listingId]
  delete registry.installedAt[listingId]
  if (!saveMarketplaceRegistry(registry)) return false
  unregisterAgentRunTemplate(templateId)
  return true
}

/** Wipe the local registry (test helper + "reset marketplace" affordance). */
export function clearMarketplaceRegistry(): void {
  storageRemove(MARKETPLACE_STORAGE_KEY)
}
