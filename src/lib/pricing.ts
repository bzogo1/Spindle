/**
 * Single source of truth for /pricing.
 *
 * Spindle has no paid plans. Hobby is free forever and funded by donations;
 * Enterprise is a custom arrangement for organizations that need dedicated
 * infrastructure, contracts, and support. Both cards read their price from
 * `amount`: 0 renders "$0" and null renders "Custom".
 */

export interface PlanPrice {
  /** Price shown on the card, or null for custom/contact-us pricing. */
  amount: number | null
  /** Small note next to the amount, e.g. "free forever". */
  unit: string
}

export interface Plan {
  id: string
  name: string
  tagline: string
  badge?: string
  /** Card bullets. `link` renders an inline link after the text. */
  features: { text: string; link?: { label: string; href: string } }[]
  price: PlanPrice
  cta: {
    label: string
    href: string
  }
}

/** Where donation enquiries and recurring-donation changes are handled. */
export const donationEmail = "mailto:hello@spindle.example?subject=Supporting%20Spindle"

export const plans: Plan[] = [
  {
    id: "hobby",
    name: "Hobby",
    tagline:
      "The whole product, free forever, for a single researcher or a project that's just getting started.",
    badge: "FREE FOREVER",
    features: [
      { text: "5 GB storage" },
      { text: "Lab, Search, Files, Agent, and Chat" },
      { text: "Real-time collaboration with live cursors, comments, and presence" },
      { text: "Share links and inline previews for 100+ formats" },
      { text: "Version history, run snapshots, and file recovery" },
      { text: "Offline access when the connection drops" },
      { text: "Zotero, JupyterLab, RStudio, and VS Code integrations" },
      { text: "Automations and cron jobs" },
      { text: "20 agent requests per day" },
      { text: "50 extra agent requests by referral" },
    ],
    price: { amount: 0, unit: "free forever" },
    cta: { label: "Create your workspace", href: "/sign-up" },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline:
      "A custom agreement for organizations that need dedicated infrastructure, contracts, and support.",
    badge: "CUSTOM AGREEMENT",
    features: [
      { text: "Everything in Hobby, with custom storage and agent allowances" },
      { text: "Dedicated infrastructure and an uptime SLA" },
      { text: "SSO, audit logs, and role controls" },
      { text: "Onboarding and training for your organization" },
      { text: "Custom integrations and workflows" },
      { text: "Countersigned", link: { label: "DPA and subprocessor list", href: "/dpa" } },
    ],
    price: { amount: null, unit: "custom" },
    cta: { label: "Contact us", href: "/contact" },
  },
]

export interface FundingArea {
  icon: string
  title: string
  body: string
}

/** What donations actually pay for, in plain terms. */
export const fundingAreas: FundingArea[] = [
  {
    icon: "i-server",
    title: "Servers and compute",
    body: "Lab sessions, agent runs, search, and the app itself all need machines that stay on. Donations cover that compute bill, not just the marketing site.",
  },
  {
    icon: "i-refresh",
    title: "Storage and backups",
    body: "Every free workspace starts with 5 GB. Object storage, redundancy, and backups are recurring costs that grow with every project people trust us with.",
  },
  {
    icon: "i-code",
    title: "Development",
    body: "New features and the unglamorous work behind them: the Lab runtime, the agent's review flow, real-time collaboration, accessibility, and bug fixes.",
  },
  {
    icon: "i-shield",
    title: "Maintenance and support",
    body: "Security patches, dependency upgrades, monitoring, incident response, and answering the email that arrives when something breaks.",
  },
]

export interface SupportOption {
  icon: string
  title: string
  body: string
  cta: { label: string; href: string; external?: boolean }
}

/** Non-monetary support counts too, but these are the ways to chip in. */
export const supportOptions: SupportOption[] = [
  {
    icon: "i-refresh",
    title: "Give monthly",
    body: "The most useful kind of support: steady enough to plan storage and servers around instead of guessing month to month.",
    cta: { label: "Set up a monthly donation", href: donationEmail },
  },
  {
    icon: "i-bolt",
    title: "Give once",
    body: "A one-time contribution covers a slice of the infrastructure bill or a focused week of maintenance and fixes.",
    cta: { label: "Make a one-time donation", href: donationEmail },
  },
  {
    icon: "i-users",
    title: "Share Spindle",
    body: "Referrals bring in people who might use Spindle and keep it alive. You get 50 extra agent requests when someone joins.",
    cta: { label: "See the referral program", href: "/referral" },
  },
  {
    icon: "i-github",
    title: "Contribute",
    body: "Bug reports, documentation, and code all help. Open an issue or send a pull request on GitHub.",
    cta: {
      label: "Open GitHub",
      href: "https://github.com/spindle-labs/spindle",
      external: true,
    },
  },
]

export interface Faq {
  question: string
  answer: string
}

export const pricingFaqs: Faq[] = [
  {
    question: "Why is Spindle free?",
    answer:
      "Spindle has no paid plans. The Hobby plan is $0 forever and includes the whole product — files, Lab, Search, Agent, chat, automations, and real-time collaboration. Donations from people who find it useful pay for the servers, storage, bandwidth, and the time it takes to build and maintain it. Enterprise is the only paid arrangement, and it is a custom contract for organizations that need dedicated infrastructure and support.",
  },
  {
    question: "How are donations used?",
    answer:
      "Donations go straight into running and improving Spindle: compute for Lab sessions and agent runs, object storage and backups, bandwidth and hosted search, security updates, monitoring, and development time. There is no advertising or data-sales revenue topping it up, so the donation total is what keeps the lights on.",
  },
  {
    question: "Do I have to donate to use Spindle?",
    answer:
      "No. Donating is optional and unlocks nothing. Every feature on the Hobby plan is available whether or not you give, and there is no nag screen, trial clock, or locked tab waiting to be paid for.",
  },
  {
    question: "Is real-time collaboration included in the free plan?",
    answer:
      "Yes. Shared workspaces, live cursors, presence, comments, and project chat are part of Hobby at no cost. Invite the people you work with and start in the same project — collaboration is not a paid add-on.",
  },
  {
    question: "Do I pay per person?",
    answer:
      "No. There is no per-seat price and no seat count to manage. Hobby is one workspace with 5 GB of storage, and the people you invite do not change what you pay, because you are not paying.",
  },
  {
    question: "What does Enterprise include, and how is it priced?",
    answer:
      "Enterprise is a custom agreement rather than a public subscription. It can include dedicated infrastructure and an uptime SLA, SSO, audit logs, role controls, onboarding and training, custom integrations, and a countersigned DPA. Pricing depends on scope and infrastructure, so contact us and we will quote the work.",
  },
  {
    question: "What happens when I hit the storage limit?",
    answer:
      "Uploads and new lab-session outputs pause, and your existing files stay readable — nothing is deleted. You can free up space or talk to us about an Enterprise arrangement if your work regularly needs more than 5 GB. Agent requests follow the same pattern: the daily allowance resets at midnight UTC, and referral bonus requests never expire.",
  },
  {
    question: "How do agent requests work?",
    answer:
      "One task counts as one request, however many steps it takes. The free plan includes 20 per day; referring a friend who creates an account adds 50 one-time requests that never expire. Retrying inside the same task does not start a new one.",
  },
  {
    question: "Do you show ads or sell my data?",
    answer:
      "No. Spindle does not run ads, sell data, or build advertising profiles. Search goes through a Spindle-hosted SearXNG instance, and project content stays inside your workspace. Donations are the funding model precisely so the product does not need to monetize your research.",
  },
  {
    question: "How can I support Spindle if I can't donate?",
    answer:
      "Refer someone, report bugs, improve the docs, contribute code on GitHub, or simply tell people about the project. Using Spindle and telling us what breaks is real support — donations are one input, not the only one.",
  },
  {
    question: "Can I stop a recurring donation?",
    answer:
      "Yes, at any time. Email hello@spindle.example and we will cancel it or send you the current management link. Stopping a donation never changes your workspace, your storage, or your access to any feature.",
  },
  {
    question: "How is my research data handled?",
    answer:
      "Your workspace content is yours. Spindle processes it only to provide the service, keeps projects isolated, and publishes a DPA and subprocessor list for signed agreements. Regional data residency and custom retention are available through Enterprise arrangements; the security and trust centre has the details.",
  },
]

/** Stats grid values — derived from the plan data where possible. */
export const pricingStats = [
  { value: "5", suffix: " GB", label: "Storage on the free plan" },
  { value: "20", suffix: "", label: "Agent requests every day" },
  { value: "100", suffix: "+", label: "Formats detected inline" },
  { value: "50", suffix: "", label: "Extra requests by referral" },
] as const
