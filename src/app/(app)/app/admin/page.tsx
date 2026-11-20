import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Award,
  Banknote,
  BarChart3,
  Briefcase,
  CalendarClock,
  Coins,
  FileText,
  Filter,
  Flag,
  FlaskConical,
  Gift,
  Handshake,
  History,
  Inbox,
  LayoutTemplate,
  Mail,
  Megaphone,
  MousePointerClick,
  NotebookPen,
  RotateCcw,
  Route,
  Scale,
  Send,
  ShieldAlert,
  TestTube,
  TrendingDown,
  Users,
  VenetianMask,
} from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = { title: "Admin" }

const SECTIONS = [
  {
    href: "/app/admin/users",
    icon: <Users aria-hidden="true" />,
    title: "Users",
    description:
      "Browse registered accounts, inspect a user's details, and manage the fields the backend supports.",
  },
  {
    href: "/app/admin/affiliates",
    icon: <Handshake aria-hidden="true" />,
    title: "Affiliates",
    description:
      "Review affiliate applications, approve or reject them, and monitor tracking stats.",
  },
  {
    href: "/app/admin/audit",
    icon: <History aria-hidden="true" />,
    title: "Audit log",
    description: "Review authentication and security events recorded across the platform.",
  },
  {
    href: "/app/admin/newsletter",
    icon: <Mail aria-hidden="true" />,
    title: "Newsletter",
    description: "Review subscribers and manage draft campaigns for the mailing list.",
  },
  {
    href: "/app/admin/email-schedule",
    icon: <CalendarClock aria-hidden="true" />,
    title: "Email schedule",
    description: "Queue outbound emails for later delivery and cancel pending sends.",
  },
  {
    href: "/app/admin/email-ab",
    icon: <FlaskConical aria-hidden="true" />,
    title: "Email A/B",
    description: "Manage email subject/body experiments and deterministic variant assignment.",
  },
  {
    href: "/app/admin/contact",
    icon: <Inbox aria-hidden="true" />,
    title: "Contact inbox",
    description: "Review messages sent through the public contact form.",
  },
  {
    href: "/app/admin/impersonation",
    icon: <VenetianMask aria-hidden="true" />,
    title: "Impersonation",
    description: "Start a support session as another user to reproduce issues.",
  },
  {
    href: "/app/admin/announcements",
    icon: <Megaphone aria-hidden="true" />,
    title: "Announcements",
    description: "Publish feature announcements shown as dismissible banners to app users.",
  },
  {
    href: "/app/admin/beta",
    icon: <TestTube aria-hidden="true" />,
    title: "Beta programs",
    description: "Create beta programs and manage self-service enrollment and enrolled users.",
  },
  {
    href: "/app/admin/feature-flags",
    icon: <Flag aria-hidden="true" />,
    title: "Feature flags",
    description: "Manage runtime feature flags with per-user targeting and percentage rollouts.",
  },
  {
    href: "/app/admin/segments",
    icon: <Filter aria-hidden="true" />,
    title: "Segments",
    description: "Build rule-based user segments evaluated against the auth backend.",
  },
  {
    href: "/app/admin/churn",
    icon: <TrendingDown aria-hidden="true" />,
    title: "Churn risk",
    description: "Heuristic risk scoring across accounts, ranked by signal strength.",
  },
  {
    href: "/app/admin/win-back",
    icon: <RotateCcw aria-hidden="true" />,
    title: "Win-back campaigns",
    description: "Re-engagement email campaigns for inactive users, run as admin-triggered drafts.",
  },
  {
    href: "/app/admin/commissions",
    icon: <Coins aria-hidden="true" />,
    title: "Commissions",
    description:
      "Review and manage affiliate commission records; marking paid is a ledger status only.",
  },
  {
    href: "/app/admin/payouts",
    icon: <Banknote aria-hidden="true" />,
    title: "Payouts",
    description:
      "Run simulated affiliate payout batches over commission periods — no real money moves.",
  },
  {
    href: "/app/admin/tax-forms",
    icon: <FileText aria-hidden="true" />,
    title: "Tax forms",
    description: "Review partner W-9 submissions and generate simulated 1099-NEC records.",
  },
  {
    href: "/app/admin/partner-portal",
    icon: <Briefcase aria-hidden="true" />,
    title: "Partner portal",
    description: "Partner account overview, portal announcements, and resource links.",
  },
  {
    href: "/app/admin/compliance",
    icon: <Scale aria-hidden="true" />,
    title: "Compliance",
    description:
      "Affiliate compliance cases — fraud reviews, policy violations, payout holds, and KYC.",
  },
  {
    href: "/app/admin/referral-program",
    icon: <Gift aria-hidden="true" />,
    title: "Referral program",
    description: "Program settings, attribution stats, and the recent referral activity feed.",
  },
  {
    href: "/app/admin/referral-tracking",
    icon: <Route aria-hidden="true" />,
    title: "Referral tracking",
    description: "Funnel-style referral tracking with per-source and per-code breakdowns.",
  },
  {
    href: "/app/admin/referral-analytics",
    icon: <BarChart3 aria-hidden="true" />,
    title: "Referral analytics",
    description:
      "Program-level referral performance — health score, cohorts, leaderboard, and fraud exposure.",
  },
  {
    href: "/app/admin/referral-fraud",
    icon: <ShieldAlert aria-hidden="true" />,
    title: "Referral fraud",
    description: "Review queue for referrals flagged by the fraud rules.",
  },
  {
    href: "/app/admin/referral-rewards",
    icon: <Award aria-hidden="true" />,
    title: "Referral rewards",
    description: "Issue and revoke reporting rewards for qualified referral attributions.",
  },
  {
    href: "/app/admin/email-delivery",
    icon: <Send aria-hidden="true" />,
    title: "Email delivery",
    description: "Track outbound email lifecycle events from queued to clicked and bounced.",
  },
  {
    href: "/app/admin/email-templates",
    icon: <LayoutTemplate aria-hidden="true" />,
    title: "Email templates",
    description: "Edit plain-text email templates with variable placeholders and live preview.",
  },
  {
    href: "/app/admin/landing-ab",
    icon: <MousePointerClick aria-hidden="true" />,
    title: "Landing A/B",
    description: "Manage landing-page experiments, variant weights, and per-variant results.",
  },
  {
    href: "/app/admin/release-notes",
    icon: <NotebookPen aria-hidden="true" />,
    title: "Release notes email",
    description: "Preview and send the latest changelog entries to newsletter subscribers.",
  },
] as const

export default function AdminPage() {
  return (
    <div className="app-page">
      <div className="app-page-head">
        <div>
          <h1 className="app-page-title">Admin</h1>
          <p className="app-page-subtitle">
            Platform administration tools. These areas are restricted to accounts listed in the
            admin allowlist.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="group block">
            <Card className="group-hover:border-foreground/20 h-full transition-colors">
              <CardHeader>
                <div className="flex items-center gap-2">
                  {section.icon}
                  <CardTitle className="text-base">{section.title}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                  Open
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
