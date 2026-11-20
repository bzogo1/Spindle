/**
 * Single source of truth for /pricing.
 *
 * Plan cards, the comparison table, and the stats grid all read from here so
 * numbers cannot drift between sections.
 *
 * NOTE: Team and Enterprise use contact-us pricing (`amount: null`) — there
 * are no public seat prices yet. Plans with a real price expose a numeric
 * `amount`; custom plans render as "Custom" via the same path as Enterprise.
 */

export type BillingPeriod = "monthly" | "yearly"

export interface PlanPrice {
  /** Price per billing period unit, or null for custom/contact-us pricing. */
  amount: number | null
  /** Display unit, e.g. "mo", "yr", "seat/mo". */
  unit: string
  /** Set when the plan is billed per seat rather than flat. */
  perSeat?: boolean
}

export interface Plan {
  id: string
  name: string
  tagline: string
  badge?: string
  /** Card bullets. `link` renders an inline link after the text. */
  features: { text: string; link?: { label: string; href: string } }[]
  price: Record<BillingPeriod, PlanPrice>
  cta: {
    label: string
    href: string
  }
  /** Comparison-table cells, aligned with `comparisonRows`. `true` = check, string = value, "—" = not included. */
  comparison: (string | boolean)[]
}

export const billingPeriods: { id: BillingPeriod; label: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
]

/** Shown next to the yearly toggle when a discount applies. */
export const yearlyDiscountNote = "Save 20% with yearly billing"

export const plans: Plan[] = [
  {
    id: "hobby",
    name: "Hobby",
    tagline: "For a single researcher or a project that's just getting started.",
    features: [
      { text: "5 GB storage" },
      { text: "Lab, Search, Files, Agent, and Chat" },
      { text: "Automations and cron jobs" },
      { text: "20 agent requests per day" },
      { text: "50 extra agent requests by referral" },
    ],
    price: {
      monthly: { amount: 0, unit: "forever" },
      yearly: { amount: 0, unit: "forever" },
    },
    cta: { label: "Create your workspace", href: "/sign-up" },
    comparison: ["5 GB", "20 / day", "1 seat", false, false, false, false, "Community", "—"],
  },
  {
    id: "team",
    name: "Team",
    tagline: "Shared workspaces, more storage, and room to grow with your group.",
    badge: "MOST POPULAR",
    features: [
      { text: "100 GB storage per seat" },
      { text: "Everything in Hobby" },
      { text: "Shared workspaces and real-time collaboration" },
      { text: "500 agent requests per seat per day" },
      { text: "Priority email support" },
    ],
    // Contact-us pricing, same pattern as Enterprise — no public seat price.
    price: {
      monthly: { amount: null, unit: "custom" },
      yearly: { amount: null, unit: "custom" },
    },
    cta: { label: "Contact us", href: "/contact" },
    comparison: [
      "100 GB / seat",
      "500 / seat / day",
      "Unlimited",
      true,
      false,
      false,
      false,
      "Priority email",
      "—",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom features, dedicated support, and anything your organization needs.",
    features: [
      { text: "Custom integrations and workflows" },
      { text: "Dedicated infrastructure and SLA" },
      { text: "Onboarding and training for your team" },
      { text: "Countersigned", link: { label: "DPA and subprocessor list", href: "/dpa" } },
      { text: "SSO and audit logs" },
    ],
    price: {
      monthly: { amount: null, unit: "custom" },
      yearly: { amount: null, unit: "custom" },
    },
    cta: { label: "Contact us", href: "/contact" },
    comparison: [
      "Custom",
      "Custom",
      "Unlimited",
      true,
      true,
      true,
      true,
      "Dedicated + SLA",
      "Custom",
    ],
  },
]

export interface ComparisonRow {
  label: string
  /** Optional hint shown under the label. */
  hint?: string
}

export const comparisonRows: ComparisonRow[] = [
  { label: "Storage" },
  { label: "Agent requests" },
  { label: "Seats" },
  { label: "Shared workspaces" },
  { label: "SSO / SAML" },
  { label: "Audit logs" },
  { label: "Uptime SLA" },
  { label: "Support" },
  { label: "Data region" },
]

export interface Faq {
  question: string
  answer: string
}

export const pricingFaqs: Faq[] = [
  {
    question: "What happens when I hit the storage limit?",
    answer:
      "Uploads pause and your existing files stay readable — nothing is deleted. You can free up space, upgrade to a larger plan, or talk to us about a custom allowance. Agent requests follow the same pattern: the daily allowance resets at midnight UTC, and referral bonus requests never expire.",
  },
  {
    question: "How do agent requests work?",
    answer:
      "Every agent run counts as one request against your daily allowance. The free plan includes 20 per day; referring a friend who creates an account adds 50 one-time requests that never expire. Paid plans scale the allowance per seat.",
  },
  {
    question: "Can I switch between monthly and yearly billing?",
    answer:
      "Yes. You can change your billing period at any time from workspace settings. Upgrading to yearly applies the annual discount immediately and credits any unused time on your current cycle.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes — cancel from workspace settings and your plan stays active until the end of the paid period. We don't charge cancellation fees, and your data remains exportable for 90 days after the workspace closes.",
  },
  {
    question: "How do seats and collaboration work?",
    answer:
      "Team and Enterprise plans include shared workspaces where members see the same files, lab sessions, and agent history in real time. Add or remove seats at any time; seat changes are prorated on your next invoice.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "The Hobby plan is free forever with no credit card required, so you can evaluate the full workspace before paying. Paid plans can be trialed on request — contact us and we'll set one up for your team.",
  },
  {
    question: "How is my research data handled?",
    answer:
      "Your workspace content is yours. Spindle processes it only to provide the service, supports regional data residency on Enterprise plans, and publishes a DPA and subprocessor list for signed agreements. See the security and trust centre for details.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "If something goes wrong in the first 14 days of a paid plan, contact us and we'll make it right — typically a full refund or credit. After that, fees are non-refundable except where the law requires otherwise, as described in the terms.",
  },
]

/** Stats grid values — derived from the plan data where possible. */
export const pricingStats = [
  { value: "5", suffix: " GB", label: "Storage on the free plan" },
  { value: "20", suffix: "", label: "Agent requests every day" },
  { value: "100", suffix: "+", label: "Formats detected inline" },
  { value: "50", suffix: "", label: "Extra requests by referral" },
] as const
