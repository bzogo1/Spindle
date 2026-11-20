import type { ReactNode } from "react"
import {
  Bot,
  Briefcase,
  Building2,
  Files,
  FlaskConical,
  FolderKanban,
  Gift,
  Handshake,
  LayoutDashboard,
  MessageSquare,
  MessageSquarePlus,
  MonitorSmartphone,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube,
  Ticket,
  UserCog,
  UsersRound,
  Workflow,
} from "lucide-react"

export type NavItem = {
  label: string
  href: string
  icon: ReactNode
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
