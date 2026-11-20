import { AUTOMATION_TEMPLATES, type AutomationTemplate } from "./templates"

/**
 * Template marketplace metadata. Ratings and install counts are local mock
 * data — there is no marketplace backend yet. Templates themselves live in
 * `templates.ts`; this module layers browse/search/install affordances on top.
 */

export type TemplateCategory = "digest" | "alerting" | "data" | "ops" | "triage"

export const TEMPLATE_CATEGORIES: readonly { id: TemplateCategory; label: string }[] = [
  { id: "digest", label: "Digests & summaries" },
  { id: "alerting", label: "Alerting" },
  { id: "data", label: "Data pipelines" },
  { id: "ops", label: "Operations" },
  { id: "triage", label: "Triage & routing" },
]

export interface MarketplaceTemplate extends AutomationTemplate {
  category: TemplateCategory
  /** Mock rating, 1–5 with one decimal. */
  rating: number
  /** Mock install count. */
  installs: number
  tags: string[]
}

interface TemplateMeta {
  category: TemplateCategory
  rating: number
  installs: number
  tags: string[]
}

const META: Record<string, TemplateMeta> = {
  "daily-digest": {
    category: "digest",
    rating: 4.6,
    installs: 1284,
    tags: ["schedule", "agent", "summary"],
  },
  "file-change-alert": {
    category: "alerting",
    rating: 4.2,
    installs: 867,
    tags: ["event", "condition", "notify"],
  },
  "weekly-index-refresh": {
    category: "ops",
    rating: 4.4,
    installs: 512,
    tags: ["schedule", "agent", "files"],
  },
  "event-triage": {
    category: "triage",
    rating: 4.8,
    installs: 1903,
    tags: ["event", "condition", "routing"],
  },
  "csv-cleanup": {
    category: "data",
    rating: 4.1,
    installs: 655,
    tags: ["schedule", "transform", "files"],
  },
  "error-alert": {
    category: "alerting",
    rating: 4.5,
    installs: 743,
    tags: ["event", "condition", "log"],
  },
}

const FALLBACK_META: TemplateMeta = {
  category: "ops",
  rating: 4.0,
  installs: 0,
  tags: [],
}

/** All templates enriched with marketplace metadata (stable order). */
export function marketplaceTemplates(): MarketplaceTemplate[] {
  return AUTOMATION_TEMPLATES.map((template) => ({
    ...template,
    ...(META[template.id] ?? FALLBACK_META),
    tags: [...(META[template.id]?.tags ?? [])],
  }))
}

export function getMarketplaceTemplate(id: string): MarketplaceTemplate | undefined {
  return marketplaceTemplates().find((template) => template.id === id)
}

function matchesQuery(template: MarketplaceTemplate, query: string): boolean {
  if (!query) return true
  const haystack = [
    template.name,
    template.description,
    template.category,
    ...template.tags,
    TEMPLATE_CATEGORIES.find((c) => c.id === template.category)?.label ?? "",
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

/** Filter marketplace templates by free-text query and optional category. */
export function searchMarketplace(
  query = "",
  category?: TemplateCategory | "all",
): MarketplaceTemplate[] {
  return marketplaceTemplates()
    .filter((template) => (category && category !== "all" ? template.category === category : true))
    .filter((template) => matchesQuery(template, query.trim()))
    .sort((a, b) => b.rating - a.rating || b.installs - a.installs)
}

export function categoryLabel(category: TemplateCategory): string {
  return TEMPLATE_CATEGORIES.find((entry) => entry.id === category)?.label ?? category
}

/** Format an install count for display, e.g. 1903 → "1.9k". */
export function formatInstalls(count: number): string {
  if (count >= 1000) {
    const value = count / 1000
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)}k`
  }
  return String(count)
}
