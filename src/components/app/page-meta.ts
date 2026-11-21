import { NAV_ITEMS } from "@/components/app/nav-items"

/**
 * Route → page metadata helpers for the AppPage chrome (title, lede,
 * breadcrumbs, help topics). Kept out of app-shell so the shell stays a thin
 * layout; the page-level components own everything about "where am I".
 */

export interface PageCrumb {
  label: string
  href?: string
}

export interface PageMeta {
  /** Section title — used as the fallback when AppPage has no `title` prop. */
  title: string
  /** Section lede — used as the fallback when AppPage has no `lede` prop. */
  lede: string
  /** Breadcrumb trail, root first. The last crumb is the current page. */
  crumbs: PageCrumb[]
}

/** Per-section ledes keyed by nav href; unknown routes get a generic lede. */
const SECTION_LEDES: Record<string, string> = {
  "/dashboard": "Your workspace at a glance — projects, activity, and quick actions.",
  "/projects": "Every project in this workspace, with their labs, chats, and files.",
  "/app/files": "The workspace file library — uploads, folders, and previews.",
  "/app/lab": "Notebooks, scripts, and live computations for the selected project.",
  "/app/chat": "Conversations with your workspace — human collaborators and the agent.",
  "/app/agent": "Runs, prompts, and traces for the workspace agent.",
  "/app/automations": "Scheduled and event-driven workflows across your projects.",
  "/app/cohorts": "User cohorts for segmentation, experiments, and targeted messaging.",
  "/app/security": "Security policies, alerts, and audit signals for the workspace.",
  "/app/sessions": "Active sessions across devices and locations.",
  "/app/workspaces": "Workspaces you belong to and their members.",
  "/app/affiliate": "Affiliate program links, conversions, and payouts.",
  "/app/partner": "Partner program resources and shared campaigns.",
  "/app/referral": "Referral links, rewards, and invite tracking.",
  "/app/beta": "Beta programs you can join and their feedback threads.",
  "/app/admin": "Administrative controls for the workspace.",
  "/app/support": "Support tickets and help requests.",
  "/app/feedback": "Send feedback and browse past submissions.",
  "/app/whats-new": "Release notes and product updates.",
  "/app/settings": "Workspace and account preferences.",
}

const DEFAULT_LEDE = "Manage this part of your workspace."

/** Project-scoped section labels for `/projects/[id]/*` routes. */
const PROJECT_SECTIONS: Record<string, string> = {
  lab: "Lab",
  chat: "Chat",
  files: "Files",
  settings: "Settings",
  activity: "Activity",
  analytics: "Analytics",
}

function navItemFor(pathname: string) {
  return NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
}

/**
 * Resolve title, lede and breadcrumb trail for a pathname. Project routes get
 * a "Projects › <project> › <section>" trail; `/app/*` routes fall back to the
 * matching nav item; anything else resolves to a generic "Spindle" page.
 */
export function pageMetaFor(pathname: string): PageMeta {
  const crumbs: PageCrumb[] = []

  if (pathname.startsWith("/projects")) {
    const segments = pathname.split("/").filter(Boolean) // ["projects", id?, section?]
    crumbs.push({ label: "Projects", href: "/projects" })
    if (segments[1]) {
      // Project names are not resolvable here without a fetch; the id slug is
      // the best stable label available to the chrome.
      crumbs.push({ label: segments[1], href: `/projects/${segments[1]}` })
      const section = segments[2]
      if (section) {
        const label = PROJECT_SECTIONS[section] ?? section
        crumbs.push({ label })
        return {
          title: label,
          lede: `Project-scoped ${label.toLowerCase()} for this project.`,
          crumbs,
        }
      }
      return { title: segments[1], lede: "Project overview.", crumbs }
    }
    return {
      title: "Projects",
      lede: SECTION_LEDES["/projects"] ?? DEFAULT_LEDE,
      crumbs,
    }
  }

  const item = navItemFor(pathname)
  if (item) {
    crumbs.push({ label: item.label })
    return {
      title: item.label,
      lede: SECTION_LEDES[item.href] ?? DEFAULT_LEDE,
      crumbs,
    }
  }

  crumbs.push({ label: "Spindle" })
  return { title: "Spindle", lede: DEFAULT_LEDE, crumbs }
}

/** Short help topics per nav section, shown by the page help dialog. */
const SECTION_HELP: Record<string, string[]> = {
  "/dashboard": [
    "Widgets summarise project activity, storage, and agent runs.",
    "Use the quick actions to jump into a project or start a new automation.",
    "Drag widgets to reorder; layouts are saved per workspace.",
  ],
  "/projects": [
    "Projects group lab notebooks, chats, files, and automations.",
    "Create a project from the header action, then pick a section inside it.",
    "Archive a project from its settings to hide it without deleting data.",
  ],
  "/app/files": [
    "Upload files or create folders from the toolbar.",
    "Click a file to open the preview drawer; share links expire after 7 days.",
    "Use the filter bar to narrow by type, owner, or date.",
  ],
  "/app/lab": [
    "Pick a project first — the lab is scoped per project.",
    "Notebooks run cells top to bottom; snapshots are kept automatically.",
    "Compare two snapshots to see what changed between runs.",
  ],
  "/app/chat": [
    "Channels belong to a project; pick one to see its conversations.",
    "Mention @agent to run the workspace agent inside a thread.",
    "Mute a channel from its header menu to pause notifications.",
  ],
  "/app/agent": [
    "Each run shows prompts, tool calls, and token cost.",
    "Replay a run to inspect the exact trace step by step.",
    "Cancel a running agent from the run detail page.",
  ],
  "/app/automations": [
    "Automations trigger on schedules or events like file uploads.",
    "Open the builder to edit the graph; drafts publish on save.",
    "Version history lets you restore a previous graph snapshot.",
  ],
  "/app/settings": [
    "Profile, security, and workspace preferences live here.",
    "Import/export settings from the data section at the bottom.",
    "Changes apply immediately; some need a workspace admin role.",
  ],
}

const DEFAULT_HELP = [
  "Use the actions menu (top right) to export, share, or open page settings.",
  "The bookmark button saves this page for quick access later.",
  "Stuck? The feedback button sends a report straight to the team.",
]

/** Help bullets for the current pathname, resolved against nav sections. */
export function helpTopicsFor(pathname: string): string[] {
  if (pathname.startsWith("/projects")) {
    return [
      "Project pages group lab, chat, files, activity, and settings.",
      "Switch projects with the project switcher in the top bar.",
      "Use the actions menu to export or share this project page.",
    ]
  }
  const item = navItemFor(pathname)
  if (item && SECTION_HELP[item.href]) return SECTION_HELP[item.href]
  return DEFAULT_HELP
}
