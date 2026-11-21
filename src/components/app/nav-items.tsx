import type { ReactNode } from "react"
import {
  Bell,
  Bot,
  Briefcase,
  Building2,
  CircleUser,
  CircleUserRound,
  Files,
  Flag,
  FlaskConical,
  FolderKanban,
  Gift,
  Handshake,
  History,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  MessageSquarePlus,
  MonitorSmartphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube,
  Ticket,
  UserCog,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react"

export type NavItem = {
  label: string
  href: string
  icon: ReactNode
}

/**
 * A nav entry inside a {@link NavGroup}. Unlike the flat {@link NAV_ITEMS}
 * (which the command menu and keyboard shortcuts iterate), group entries may
 * carry nested `children` rendered as an indented sub-list.
 */
export type NavEntry = NavItem & {
  children?: NavItem[]
}

export type NavGroup = {
  label: string
  icon: ReactNode
  items: NavEntry[]
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard aria-hidden="true" /> },
  { label: "Projects", href: "/projects", icon: <FolderKanban aria-hidden="true" /> },
  { label: "Files", href: "/app/files", icon: <Files aria-hidden="true" /> },
  { label: "Lab", href: "/app/lab", icon: <FlaskConical aria-hidden="true" /> },
  { label: "Chat", href: "/app/chat", icon: <MessageSquare aria-hidden="true" /> },
  { label: "Agent", href: "/app/agent", icon: <Bot aria-hidden="true" /> },
  { label: "Automations", href: "/app/automations", icon: <Workflow aria-hidden="true" /> },
  { label: "Cohorts", href: "/app/cohorts", icon: <UsersRound aria-hidden="true" /> },
  { label: "Security", href: "/app/security", icon: <ShieldCheck aria-hidden="true" /> },
  { label: "Sessions", href: "/app/sessions", icon: <MonitorSmartphone aria-hidden="true" /> },
  { label: "Workspaces", href: "/app/workspaces", icon: <Building2 aria-hidden="true" /> },
  { label: "Affiliates", href: "/app/affiliate", icon: <Handshake aria-hidden="true" /> },
  { label: "Partner", href: "/app/partner", icon: <Briefcase aria-hidden="true" /> },
  { label: "Referrals", href: "/app/referral", icon: <Gift aria-hidden="true" /> },
  { label: "Beta programs", href: "/app/beta", icon: <TestTube aria-hidden="true" /> },
  // Admin section: visible to everyone in the nav, but /app/admin/* 404s for
  // non-admins (ADMIN_EMAILS seam — see src/lib/admin-guard.ts). There is no
  // session-role signal on NAV_ITEMS to hide it selectively yet.
  { label: "Admin", href: "/app/admin", icon: <UserCog aria-hidden="true" /> },
  { label: "Support", href: "/app/support", icon: <Ticket aria-hidden="true" /> },
  { label: "Feedback", href: "/app/feedback", icon: <MessageSquarePlus aria-hidden="true" /> },
  { label: "What's new", href: "/app/whats-new", icon: <Sparkles aria-hidden="true" /> },
  { label: "Settings", href: "/app/settings", icon: <Settings aria-hidden="true" /> },
]

/** Looks up a flat {@link NAV_ITEMS} entry by its label. */
function pick(label: string): NavItem {
  const item = NAV_ITEMS.find((entry) => entry.label === label)
  if (!item) throw new Error(`Unknown NAV_ITEMS label: ${label}`)
  return item
}

/**
 * Sidebar navigation grouped into collapsible sections. Every top-level entry
 * still comes from {@link NAV_ITEMS} (spread to attach nested `children`), so
 * the flat list stays the single source of truth for the command menu and
 * keyboard shortcuts.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    icon: <LayoutDashboard aria-hidden="true" />,
    items: [pick("Dashboard"), pick("Projects")],
  },
  {
    label: "Workspace",
    icon: <FolderKanban aria-hidden="true" />,
    items: [pick("Files"), pick("Chat"), pick("Agent"), pick("Automations"), pick("Lab")],
  },
  {
    label: "Organization",
    icon: <Building2 aria-hidden="true" />,
    items: [
      pick("Workspaces"),
      pick("Cohorts"),
      pick("Affiliates"),
      pick("Partner"),
      pick("Referrals"),
      pick("Beta programs"),
    ],
  },
  {
    label: "Account",
    icon: <UserRound aria-hidden="true" />,
    items: [
      {
        ...pick("Security"),
        children: [
          { label: "Login history", href: "/app/security/login-history", icon: <History aria-hidden="true" /> },
          { label: "Policies", href: "/app/security/policies", icon: <ScrollText aria-hidden="true" /> },
          { label: "Session limits", href: "/app/security/session-limits", icon: <KeyRound aria-hidden="true" /> },
        ],
      },
      pick("Sessions"),
      {
        ...pick("Admin"),
        children: [
          { label: "Users", href: "/app/admin/users", icon: <UsersRound aria-hidden="true" /> },
          { label: "Announcements", href: "/app/admin/announcements", icon: <Megaphone aria-hidden="true" /> },
          { label: "Audit log", href: "/app/admin/audit", icon: <ScrollText aria-hidden="true" /> },
          { label: "Feature flags", href: "/app/admin/feature-flags", icon: <Flag aria-hidden="true" /> },
        ],
      },
      pick("Support"),
      pick("Feedback"),
      pick("What's new"),
      {
        ...pick("Settings"),
        children: [
          { label: "Profile", href: "/app/profile", icon: <CircleUserRound aria-hidden="true" /> },
          { label: "Account", href: "/app/account", icon: <CircleUser aria-hidden="true" /> },
          { label: "Notifications", href: "/app/account/notifications", icon: <Bell aria-hidden="true" /> },
        ],
      },
    ],
  },
]

/** True when `pathname` is `href` or a descendant of it. */
export function isNavActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Best (longest-href) nav label matching `pathname`, searching flat items and
 * nested group children. Returns `undefined` for routes outside the nav.
 */
export function findNavLabel(pathname: string): string | undefined {
  let best: { label: string; href: string } | undefined
  const visit = (items: NavItem[]) => {
    for (const item of items) {
      if (isNavActive(pathname, item.href) && (!best || item.href.length > best.href.length)) {
        best = item
      }
      const children = (item as NavEntry).children
      if (children) visit(children)
    }
  }
  visit(NAV_ITEMS)
  for (const group of NAV_GROUPS) visit(group.items)
  return best?.label
}
