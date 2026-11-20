import type { PageEntry } from "@/lib/search/providers"

/**
 * Window event that opens the site ⌘K palette. Lives here (not in
 * `site-command-menu.tsx`) so `site-nav.tsx` can dispatch it without
 * statically importing the lazily-loaded palette module.
 */
export const SITE_SEARCH_OPEN_EVENT = "spindle:open-site-search"

/**
 * Public marketing/legal pages indexed by the site ⌘K command menu. Docs
 * guides and changelog releases come from their own providers
 * (`createDocsProvider`, `createChangelogProvider`), so they are not listed
 * here.
 *
 * `section` feeds the search facet/filter UI: "Product" covers the feature
 * and pricing pages, "Learn" the docs-adjacent destinations, "Company" the
 * about/contact pages, and "Legal" the policy documents.
 */
export const SITE_PAGES: PageEntry[] = [
  { label: "Home", href: "/", keywords: "spindle research workspace", section: "Product" },
  { label: "Platform", href: "/platform", keywords: "overview features", section: "Product" },
  { label: "Solutions", href: "/solutions", keywords: "use cases teams", section: "Product" },
  {
    label: "Lab",
    href: "/lab",
    keywords: "notebooks rstudio jupyter terminal",
    section: "Product",
    tags: ["notebook"],
  },
  {
    label: "Automations",
    href: "/automations",
    keywords: "cron schedules workflows",
    section: "Product",
    tags: ["workflow"],
  },
  { label: "Agent", href: "/agent", keywords: "ai diffs approvals autonomy", section: "Product" },
  {
    label: "Collaboration",
    href: "/collaboration",
    keywords: "team chat cursors documents",
    section: "Product",
    tags: ["team"],
  },
  {
    label: "Infrastructure",
    href: "/infrastructure",
    keywords: "hosting security data",
    section: "Product",
  },
  {
    label: "Pricing",
    href: "/pricing",
    keywords: "plans free billing",
    section: "Product",
    tags: ["billing"],
  },
  { label: "Referral", href: "/referral", keywords: "refer friend invite", section: "Product" },
  { label: "About", href: "/about", keywords: "company mission", section: "Company" },
  { label: "Contact", href: "/about#contact", keywords: "email support sales", section: "Company" },
  {
    label: "Documentation",
    href: "/docs",
    keywords: "guides reference manual",
    section: "Learn",
    tags: ["doc"],
  },
  {
    label: "Changelog",
    href: "/changelog",
    keywords: "release notes what shipped",
    section: "Learn",
  },
  { label: "Terms of Service", href: "/terms", keywords: "legal terms", section: "Legal" },
  { label: "Privacy Policy", href: "/privacy", keywords: "legal privacy data", section: "Legal" },
  { label: "Cookie Policy", href: "/cookies", keywords: "legal cookies consent", section: "Legal" },
  {
    label: "DPA & Subprocessors",
    href: "/dpa",
    keywords: "legal data processing",
    section: "Legal",
  },
  {
    label: "Acceptable Use",
    href: "/acceptable-use",
    keywords: "legal policy abuse",
    section: "Legal",
  },
  {
    label: "Security",
    href: "/security",
    keywords: "trust encryption compliance",
    section: "Legal",
  },
  {
    label: "Accessibility",
    href: "/accessibility",
    keywords: "a11y wcag statement",
    section: "Legal",
  },
]
