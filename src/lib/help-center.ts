/**
 * Help center content store.
 *
 * Self-contained seed data — there is no external CMS. Articles live in this
 * module so they ship with the bundle and stay easy to review in diffs.
 * The public API (`/api/help/articles`) and the `/help` site pages both read
 * from here, so search behaviour and rendered content can never drift apart.
 *
 * Article bodies are structured blocks (paragraph / heading / list), never
 * raw HTML, so rendering is safe by construction — no sanitiser needed.
 */

export const HELP_CATEGORY_IDS = [
  "getting-started",
  "account-security",
  "billing",
  "api-integrations",
] as const

export type HelpCategoryId = (typeof HELP_CATEGORY_IDS)[number]

export type HelpCategory = {
  id: HelpCategoryId
  title: string
  description: string
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: "getting-started",
    title: "Getting started",
    description: "Create a workspace, invite your team, and get your first project moving.",
  },
  {
    id: "account-security",
    title: "Account & security",
    description: "Sign-in methods, two-factor authentication, sessions, and access control.",
  },
  {
    id: "billing",
    title: "Billing",
    description: "Plans, invoices, seats, and what happens when you hit a limit.",
  },
  {
    id: "api-integrations",
    title: "API & integrations",
    description: "Tokens, webhooks, and connecting Spindle to the tools you already use.",
  },
] as const

export type HelpBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "list"; items: readonly string[] }

export type HelpArticle = {
  slug: string
  title: string
  excerpt: string
  category: HelpCategoryId
  /** ISO date (YYYY-MM-DD) the article was last revised. */
  updatedAt: string
  /** Extra search terms that don't appear verbatim in the title/excerpt. */
  keywords: readonly string[]
  body: readonly HelpBodyBlock[]
}

export type HelpArticleSummary = Pick<
  HelpArticle,
  "slug" | "title" | "excerpt" | "category" | "updatedAt"
> & {
  categoryTitle: string
}

const p = (text: string): HelpBodyBlock => ({ type: "paragraph", text })
const h2 = (text: string): HelpBodyBlock => ({ type: "heading", level: 2, text })
const h3 = (text: string): HelpBodyBlock => ({ type: "heading", level: 3, text })
const list = (items: readonly string[]): HelpBodyBlock => ({ type: "list", items })

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: "create-your-first-workspace",
    title: "Create your first workspace",
    excerpt:
      "Workspaces are where projects, files, and team members live. Here's how to set one up in a few minutes.",
    category: "getting-started",
    updatedAt: "2025-11-02",
    keywords: ["onboarding", "setup", "new workspace", "start", "team"],
    body: [
      p(
        "A workspace is the top-level container in Spindle. Everything — projects, uploaded files, lab sessions, and automations — belongs to exactly one workspace, so think of it as your team's shared office.",
      ),
      h2("Sign up and name your workspace"),
      p(
        "Create an account with your work email, then pick a workspace name. The name appears in invites and shared links, so something recognisable helps.",
      ),
      h2("Invite your team"),
      p(
        "Open Settings → Members and send invites by email. Invited members get a link that drops them straight into the workspace once they accept.",
      ),
      list([
        "Owners can manage billing and delete the workspace.",
        "Admins can manage members and project settings.",
        "Members can create and edit projects.",
      ]),
      h2("Create your first project"),
      p(
        "From the workspace home, choose New project, give it a name, and you're ready to upload files or connect a lab session.",
      ),
    ],
  },
  {
    slug: "upload-and-organise-files",
    title: "Upload and organise files",
    excerpt:
      "Drag files into a project, organise them into folders, and understand how storage limits work.",
    category: "getting-started",
    updatedAt: "2025-10-18",
    keywords: ["files", "upload", "folders", "storage", "drag and drop", "attachments"],
    body: [
      p(
        "Every project has a Files area where you can upload documents, datasets, and images. Drag files onto the page or use the upload button — nothing is sent anywhere until you drop it.",
      ),
      h2("Folders and naming"),
      p(
        "Create folders to keep related material together. File names are preserved, and duplicates are detected so re-uploading the same file won't create a second copy.",
      ),
      h2("Storage limits"),
      p(
        "Free workspaces include 5 GB of storage. When you're approaching the limit, Spindle warns workspace admins before uploads start failing.",
      ),
      list([
        "Files are stored encrypted at rest.",
        "Deleting a file removes it from search immediately.",
        "Uploads resume automatically if your connection drops.",
      ]),
    ],
  },
  {
    slug: "run-your-first-lab-session",
    title: "Run your first lab session",
    excerpt:
      "Lab sessions run analyses on your files without leaving Spindle. Learn the basics of starting, monitoring, and reading results.",
    category: "getting-started",
    updatedAt: "2025-10-05",
    keywords: ["lab", "session", "analysis", "compute", "results", "experiment"],
    body: [
      p(
        "A lab session is a sandboxed run of an analysis or script against your project's files. Sessions are isolated per project and results are saved alongside the run so you can revisit them later.",
      ),
      h2("Start a session"),
      p(
        "Open a project, choose Lab, and pick a template or write your own script. Attach the files the session should read, then start the run.",
      ),
      h2("Monitor progress"),
      p(
        "The session view streams logs in real time. You can close the tab — the session keeps running and notifies you when it finishes.",
      ),
      h2("Read the results"),
      p(
        "Outputs appear as downloadable files and inline previews. Each run records which inputs and script version produced it, so results stay reproducible.",
      ),
    ],
  },
  {
    slug: "invite-team-members-and-roles",
    title: "Invite team members and manage roles",
    excerpt:
      "Add collaborators to your workspace, choose the right role for each person, and revoke access when someone leaves.",
    category: "getting-started",
    updatedAt: "2025-09-22",
    keywords: ["invite", "members", "roles", "permissions", "collaborators", "admin"],
    body: [
      p(
        "Workspace roles control what each member can see and change. You can change someone's role at any time from Settings → Members.",
      ),
      h2("Roles at a glance"),
      list([
        "Owner — full control, including billing and workspace deletion.",
        "Admin — manage members and project settings, but not billing.",
        "Member — create and edit projects within the workspace.",
      ]),
      h2("Inviting people"),
      p(
        "Send an email invite or share an invite link. Links expire after 7 days and can be revoked from the same settings page.",
      ),
      h2("When someone leaves"),
      p(
        "Remove the member and their access ends immediately. Their past activity remains attributed to them in the audit log.",
      ),
    ],
  },
  {
    slug: "enable-two-factor-authentication",
    title: "Enable two-factor authentication",
    excerpt:
      "Add a second step to sign-in with an authenticator app or backup codes. Recommended for anyone with admin access.",
    category: "account-security",
    updatedAt: "2025-11-10",
    keywords: ["2fa", "two factor", "totp", "authenticator", "backup codes", "mfa", "security"],
    body: [
      p(
        "Two-factor authentication (2FA) requires a code from your authenticator app in addition to your password. It protects your account even if your password leaks.",
      ),
      h2("Set it up"),
      list([
        "Go to Settings → Security → Two-factor authentication.",
        "Scan the QR code with any TOTP app (1Password, Authy, Google Authenticator).",
        "Enter the 6-digit code to confirm, then save your backup codes somewhere safe.",
      ]),
      h2("Backup codes"),
      p(
        "Backup codes are single-use and shown only once. If you lose your authenticator, a backup code gets you back in so you can re-enrol a new device.",
      ),
      h2("For workspace admins"),
      p(
        "You can require 2FA for all members of a workspace. Members without it are prompted to set it up at next sign-in.",
      ),
    ],
  },
  {
    slug: "manage-active-sessions",
    title: "Manage active sessions and devices",
    excerpt:
      "See where you're signed in, revoke a lost device, and understand how session expiry works.",
    category: "account-security",
    updatedAt: "2025-09-30",
    keywords: ["sessions", "devices", "sign out", "revoke", "login history", "logout"],
    body: [
      p(
        "Every sign-in creates a session tied to a device. You can review and revoke sessions from Settings → Security → Active sessions.",
      ),
      h2("Revoking a session"),
      p(
        "Find the device you don't recognise — it shows browser, approximate location, and last activity — and choose Sign out. Access ends immediately.",
      ),
      h2("Session lifetime"),
      p(
        "Sessions expire after 30 days of inactivity, or immediately if you change your password or revoke them manually.",
      ),
      h2("Lost a device?"),
      p(
        "Revoke the session first, then change your password. If 2FA is enabled, also check Settings → Security for backup-code usage you don't recognise.",
      ),
    ],
  },
  {
    slug: "reset-your-password",
    title: "Reset your password",
    excerpt:
      "Forgot your password or want to change it? Here's the reset flow, including what to do if the email doesn't arrive.",
    category: "account-security",
    updatedAt: "2025-10-11",
    keywords: ["password", "reset", "forgot", "change password", "email", "lockout"],
    body: [
      p(
        "Use Forgot password on the sign-in page to get a reset link by email. The link is single-use and expires after 30 minutes.",
      ),
      h2("Didn't get the email?"),
      list([
        "Check spam or promotions folders.",
        "Confirm you used the email address on the account.",
        "Wait a minute and request again — resends are rate limited to one per minute.",
      ]),
      h2("After resetting"),
      p(
        "All existing sessions are signed out for security. You'll need to sign in again on every device, including the one you reset from.",
      ),
    ],
  },
  {
    slug: "understand-plans-and-pricing",
    title: "Understand plans and pricing",
    excerpt:
      "What Free, Team, and Enterprise include — seats, storage, and which features live on which plan.",
    category: "billing",
    updatedAt: "2025-11-15",
    keywords: ["pricing", "plans", "free", "team", "enterprise", "upgrade", "seats", "storage"],
    body: [
      p(
        "Spindle has three plans. The Free plan covers one workspace with 5 GB of storage — enough for a real project. Team adds more storage, SSO, and priority support. Enterprise adds custom retention, SLAs, and dedicated onboarding.",
      ),
      h2("Seats and storage"),
      p(
        "Billing is per workspace seat. Storage is pooled across the workspace, so one heavy project doesn't change the maths for everyone else.",
      ),
      h2("Changing plans"),
      p(
        "Upgrades apply immediately and are prorated. Downgrades take effect at the end of the current billing period so you don't lose access mid-cycle.",
      ),
    ],
  },
  {
    slug: "update-payment-and-billing-details",
    title: "Update payment and billing details",
    excerpt:
      "Change your card, billing email, tax details, or download past invoices from workspace billing settings.",
    category: "billing",
    updatedAt: "2025-10-27",
    keywords: ["payment", "card", "invoice", "billing", "tax", "vat", "receipt"],
    body: [
      p(
        "Only workspace owners can edit billing. Open Settings → Billing to manage payment details and download invoices.",
      ),
      h2("Updating your card"),
      p(
        "Enter the new card details and save — the change applies to the next invoice. Your current billing period is unaffected.",
      ),
      h2("Invoices and receipts"),
      p(
        "Every invoice is available as a PDF. Add a tax ID or VAT number in billing settings and it will appear on future invoices automatically.",
      ),
      h2("Failed payments"),
      p(
        "If a payment fails, we retry over several days and email the owner. Update the card before the retries end to avoid interruption.",
      ),
    ],
  },
  {
    slug: "what-happens-at-storage-limits",
    title: "What happens at storage limits",
    excerpt:
      "Approaching or hitting the workspace storage cap — what keeps working, what pauses, and how to free up space.",
    category: "billing",
    updatedAt: "2025-09-14",
    keywords: ["storage", "limit", "quota", "full", "delete files", "upgrade"],
    body: [
      p(
        "When a workspace reaches its storage limit, new uploads and lab-session outputs pause. Existing files, search, and downloads keep working — nothing is deleted automatically.",
      ),
      h2("Warnings before the cap"),
      p(
        "Admins get an email at 80% and 95% usage, plus a banner in the app. You can also see live usage under Settings → Billing.",
      ),
      h2("Freeing up space"),
      list([
        "Delete files or projects you no longer need.",
        "Lab session outputs can be removed without touching inputs.",
        "Empty trash — deleted items still count until they're purged.",
      ]),
      h2("Need more room?"),
      p(
        "Upgrading the plan raises the pooled storage limit immediately. See Understand plans and pricing for the current tiers.",
      ),
    ],
  },
  {
    slug: "create-and-revoke-api-tokens",
    title: "Create and revoke API tokens",
    excerpt:
      "Generate personal access tokens for the Spindle API, scope them correctly, and rotate them safely.",
    category: "api-integrations",
    updatedAt: "2025-11-08",
    keywords: [
      "api",
      "token",
      "access token",
      "personal access token",
      "pat",
      "authentication",
      "bearer",
    ],
    body: [
      p(
        "API tokens let scripts and integrations act as you. Create them under Settings → Developer → API tokens. The token is shown once — store it somewhere safe.",
      ),
      h2("Scopes"),
      p(
        "Tokens can be scoped to read-only or read-write access per workspace. A read-only token can't modify anything even if leaked, so prefer the narrowest scope that works.",
      ),
      h2("Revoking tokens"),
      p(
        "Revoke a token the moment you suspect it's exposed. Revocation is instant, and any integration using it starts receiving 401 responses immediately.",
      ),
      h3("Rotation"),
      p(
        "Create the new token, update your integration, verify it works, then revoke the old one. There's no overlap window requirement — plan for a few minutes of retries.",
      ),
    ],
  },
  {
    slug: "set-up-webhooks",
    title: "Set up webhooks",
    excerpt:
      "Get notified when projects change: endpoint URLs, event types, retries, and payload signing.",
    category: "api-integrations",
    updatedAt: "2025-10-20",
    keywords: ["webhooks", "events", "notifications", "endpoint", "integrations", "payload"],
    body: [
      p(
        "Webhooks push events to your own server the moment something happens — a file upload finishes, a lab session completes, or a member joins. Configure them under Settings → Developer → Webhooks.",
      ),
      h2("Events and endpoints"),
      p(
        "Each webhook subscribes to specific event types and posts JSON payloads to an HTTPS endpoint you control. One endpoint can receive multiple event types.",
      ),
      h2("Retries and signing"),
      list([
        "Failed deliveries retry with exponential backoff for up to 24 hours.",
        "Every payload is signed — verify the signature header to confirm it came from Spindle.",
        "Payloads contain identifiers and timestamps, never file contents.",
      ]),
    ],
  },
  {
    slug: "connect-third-party-integrations",
    title: "Connect third-party integrations",
    excerpt:
      "Link Spindle to Slack, email, and calendar tools — what each integration does and how to disconnect it.",
    category: "api-integrations",
    updatedAt: "2025-09-08",
    keywords: ["integrations", "slack", "email", "calendar", "connect", "oauth", "third party"],
    body: [
      p(
        "Integrations connect Spindle to tools your team already uses. They're managed per workspace under Settings → Integrations and use OAuth, so Spindle never sees your passwords.",
      ),
      h2("What's available"),
      list([
        "Slack — project updates and lab-session completion messages in your channels.",
        "Email — thread lab results and file notifications into shared inboxes.",
        "Calendar — surface upcoming session schedules in your team's calendar.",
      ]),
      h2("Disconnecting"),
      p(
        "Disconnecting an integration revokes its access token immediately and stops all notifications. Reconnecting later requires going through the OAuth flow again.",
      ),
    ],
  },
] as const

export function isHelpCategoryId(value: string): value is HelpCategoryId {
  return (HELP_CATEGORY_IDS as readonly string[]).includes(value)
}

function categoryTitle(id: HelpCategoryId): string {
  return HELP_CATEGORIES.find((category) => category.id === id)?.title ?? id
}

function toSummary(article: HelpArticle): HelpArticleSummary {
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    category: article.category,
    categoryTitle: categoryTitle(article.category),
    updatedAt: article.updatedAt,
  }
}

export type ListArticlesFilter = {
  category?: HelpCategoryId
}

/** All articles, most recently updated first, optionally filtered by category. */
export function listArticles(filter: ListArticlesFilter = {}): HelpArticleSummary[] {
  return HELP_ARTICLES.filter((article) =>
    filter.category ? article.category === filter.category : true,
  )
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary)
}

/** Full article (including body) by slug, or undefined. */
export function getArticleBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug)
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

/**
 * Simple substring/token search over title, excerpt, keywords, slug, and
 * category. Every query token must appear somewhere in the article's search
 * text (AND semantics), and results are ranked by weighted match count:
 * title hits outweigh excerpt/keyword hits.
 */
export function searchArticles(
  query: string,
  options: ListArticlesFilter & { limit?: number } = {},
): HelpArticleSummary[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return listArticles(options)

  const categoryLabel = options.category ? categoryTitle(options.category).toLowerCase() : null

  const scored = HELP_ARTICLES.filter((article) =>
    options.category ? article.category === options.category : true,
  )
    .map((article) => {
      const title = article.title.toLowerCase()
      const excerpt = article.excerpt.toLowerCase()
      const keywords = article.keywords.join(" ").toLowerCase()
      const slug = article.slug.replace(/-/g, " ").toLowerCase()
      const haystack = `${title} ${excerpt} ${keywords} ${slug} ${categoryLabel ?? ""}`

      let score = 0
      let matched = true
      for (const token of tokens) {
        if (title.includes(token)) score += 4
        else if (keywords.includes(token)) score += 3
        else if (excerpt.includes(token) || slug.includes(token)) score += 2
        else if (haystack.includes(token)) score += 1
        else {
          matched = false
          break
        }
      }
      return { article, score, matched }
    })
    .filter((entry) => entry.matched && entry.score > 0)
    .sort((a, b) => b.score - a.score || b.article.updatedAt.localeCompare(a.article.updatedAt))
    .map((entry) => toSummary(entry.article))

  const limit = options.limit
  return typeof limit === "number" && limit > 0 ? scored.slice(0, limit) : scored
}

export type HelpCategoryWithCount = HelpCategory & { count: number }

/** Categories in display order, each with the number of published articles. */
export function listCategories(): HelpCategoryWithCount[] {
  return HELP_CATEGORIES.map((category) => ({
    ...category,
    count: HELP_ARTICLES.filter((article) => article.category === category.id).length,
  }))
}

function summaryTokens(summary: HelpArticleSummary): Set<string> {
  return new Set(
    tokenize(`${summary.title} ${summary.excerpt} ${summary.slug.replace(/-/g, " ")}`),
  )
}

/**
 * Articles related to `selected`, ranked by shared category first and then by
 * token overlap across title/excerpt/slug. Operates on summaries only, so the
 * help search UI can compute it client-side without shipping article bodies.
 */
export function relatedArticles(
  selected: HelpArticleSummary,
  pool: readonly HelpArticleSummary[] = listArticles(),
  options: { limit?: number; excludeSlug?: string } = {},
): HelpArticleSummary[] {
  const limit = options.limit ?? 4
  const excludeSlug = options.excludeSlug ?? selected.slug
  const selectedTokens = summaryTokens(selected)

  return pool
    .filter((article) => article.slug !== excludeSlug)
    .map((article) => {
      const sameCategory = article.category === selected.category ? 1 : 0
      const articleTokens = summaryTokens(article)
      let overlap = 0
      for (const token of selectedTokens) {
        if (articleTokens.has(token)) overlap += 1
      }
      return { article, score: sameCategory * 10 + overlap }
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.article.updatedAt.localeCompare(a.article.updatedAt),
    )
    .slice(0, limit)
    .map((entry) => entry.article)
}
