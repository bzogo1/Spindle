"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  Bot,
  Building2,
  CircleHelp,
  FileText,
  FlaskConical,
  FolderOpen,
  Layers3,
  Mail,
  MessagesSquare,
  Newspaper,
  NotebookPen,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { cn } from "@/lib/utils"

/* One link source drives the desktop menus and the mobile panel. */

type NavLinkItem = {
  title: string
  description: string
  href: string
  icon: LucideIcon
}

const productLinks: NavLinkItem[] = [
  {
    title: "Workspace overview",
    description: "Every project gets one home",
    href: "/#platform",
    icon: Layers3,
  },
  {
    title: "Files",
    description: "5 GB free, 100+ inline previews",
    href: "/#files",
    icon: FolderOpen,
  },
  {
    title: "The Lab",
    description: "Notebooks, R, SQL, canvas, graphs, and math",
    href: "/lab",
    icon: FlaskConical,
  },
  {
    title: "Lab notebook preview",
    description: "The Lab section on the homepage",
    href: "/#lab",
    icon: NotebookPen,
  },
  {
    title: "Local search",
    description: "Academic and Basic modes, self-hosted",
    href: "/#search",
    icon: Search,
  },
  {
    title: "Automations",
    description: "Text it, build it, or write the cron",
    href: "/automations",
    icon: Workflow,
  },
  {
    title: "Agent",
    description: "Edits files, moves them, runs autonomously",
    href: "/agent",
    icon: Bot,
  },
  {
    title: "Team chat",
    description: "Project channels, optional anonymity",
    href: "/collaboration#chat",
    icon: MessagesSquare,
  },
  {
    title: "Collaboration",
    description: "Live cursors, roles, and shared editing",
    href: "/collaboration",
    icon: Users,
  },
  {
    title: "Infrastructure",
    description: "Private by design, from TLS to storage",
    href: "/infrastructure",
    icon: ShieldCheck,
  },
  {
    title: "All features",
    description: "The whole platform on one page",
    href: "/platform",
    icon: Sparkles,
  },
]

const solutionLinks: NavLinkItem[] = [
  {
    title: "Individual researchers",
    description: "A calm place for one project",
    href: "/solutions#researchers",
    icon: NotebookPen,
  },
  {
    title: "Research labs",
    description: "Shared kernels, notes, and results",
    href: "/solutions#labs",
    icon: FlaskConical,
  },
  {
    title: "Research teams",
    description: "Channels, roles, and live presence",
    href: "/solutions#teams",
    icon: Users,
  },
  {
    title: "Institutions",
    description: "Central billing and easy onboarding",
    href: "/solutions#institutions",
    icon: Building2,
  },
]

const resourceLinks: NavLinkItem[] = [
  {
    title: "Documentation",
    description: "Set up a workspace and learn the tools",
    href: "/docs",
    icon: BookOpen,
  },
  {
    title: "Quickstart",
    description: "Your first project in a few minutes",
    href: "/docs/quickstart",
    icon: Zap,
  },
  {
    title: "Guides",
    description: "Recipes for search, automations, and lab",
    href: "/docs/guides",
    icon: FileText,
  },
  {
    title: "Changelog",
    description: "What shipped and what changed",
    href: "/changelog",
    icon: Newspaper,
  },
  { title: "FAQ", description: "Practical questions, answered", href: "/#faq", icon: CircleHelp },
]

const companyLinks: NavLinkItem[] = [
  {
    title: "About",
    description: "What Spindle is and why we built it",
    href: "/about",
    icon: Sparkles,
  },
  {
    title: "Contact",
    description: "Talk to us about your lab",
    href: "/about#contact",
    icon: Mail,
  },
]

/** The same nav renders on every page, so active state comes from the route. */
function useSiteLocation() {
  const pathname = usePathname()
  const [hash, setHash] = useState("")

  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  return { path: pathname, hash }
}

function isCurrentLink(href: string, path: string, hash: string) {
  const [linkPath, linkHash] = href.split("#")
  const normalized = linkPath.replace(/\/$/, "") || "/"
  if (linkHash) return normalized === path && hash === `#${linkHash}`
  return normalized === path
}

function NavCard({ link, current }: { link: NavLinkItem; current: boolean }) {
  const Icon = link.icon

  return (
    <li>
      <NavigationMenuLink asChild active={current}>
        <a
          href={link.href}
          className={cn("ui-nav-card", current && "is-current")}
          aria-current={current ? "page" : undefined}
        >
          <span className="ui-nav-card-icon">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="ui-nav-card-text">
            <span className="ui-nav-card-title">{link.title}</span>
            <span className="ui-nav-card-desc">{link.description}</span>
          </span>
        </a>
      </NavigationMenuLink>
    </li>
  )
}

function NavGroup({
  label,
  links,
  path,
  hash,
  wide = false,
}: {
  label: string
  links: NavLinkItem[]
  path: string
  hash: string
  wide?: boolean
}) {
  const hasCurrent = links.some((link) => isCurrentLink(link.href, path, hash))

  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger className={cn("ui-nav-trigger", hasCurrent && "is-current")}>
        {label}
      </NavigationMenuTrigger>
      <NavigationMenuContent className={cn("ui-nav-content", wide && "ui-nav-content--wide")}>
        <ul className={cn("ui-nav-grid", wide && "ui-nav-grid--wide")}>
          {links.map((link) => (
            <NavCard key={link.href} link={link} current={isCurrentLink(link.href, path, hash)} />
          ))}
        </ul>
      </NavigationMenuContent>
    </NavigationMenuItem>
  )
}

export function MainNav() {
  const { path, hash } = useSiteLocation()
  const pricingCurrent = isCurrentLink("/pricing", path, hash)

  return (
    <NavigationMenu className="ui-main-nav" aria-label="Main navigation">
      <NavigationMenuList className="ui-nav-list">
        <NavGroup label="Product" links={productLinks} path={path} hash={hash} wide />
        <NavGroup label="Solutions" links={solutionLinks} path={path} hash={hash} />
        <NavigationMenuItem>
          <NavigationMenuLink
            asChild
            active={pricingCurrent}
            className={cn(
              navigationMenuTriggerStyle(),
              "ui-nav-trigger ui-nav-trigger--link",
              pricingCurrent && "is-current",
            )}
          >
            <a href="/pricing" aria-current={pricingCurrent ? "page" : undefined}>
              Pricing
            </a>
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavGroup label="Resources" links={resourceLinks} path={path} hash={hash} />
        <NavGroup label="Company" links={companyLinks} path={path} hash={hash} />
      </NavigationMenuList>
      <NavigationMenuIndicator />
    </NavigationMenu>
  )
}

const mobileGroups = [
  { label: "Product", links: productLinks },
  { label: "Solutions", links: solutionLinks },
  { label: "Resources", links: resourceLinks },
  { label: "Company", links: companyLinks },
]

export function MobileNav() {
  const { path, hash } = useSiteLocation()

  // The toggle button lives in the header; script.js owns its open state.
  function closeMobileNav() {
    document.getElementById("mobileNav")?.classList.remove("open")
    document.getElementById("menuToggle")?.setAttribute("aria-expanded", "false")
    document.getElementById("menuToggle")?.setAttribute("aria-label", "Open menu")
  }

  return (
    <div className="ui-mobile-nav">
      {mobileGroups.map((group) => (
        <div className="ui-mobile-group" key={group.label}>
          <p className="ui-mobile-group-label">{group.label}</p>
          {group.links.map((link) => {
            const current = isCurrentLink(link.href, path, hash)
            const Icon = link.icon
            return (
              <a
                key={link.href}
                href={link.href}
                className={cn("ui-mobile-link", current && "is-current")}
                aria-current={current ? "page" : undefined}
                onClick={closeMobileNav}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {link.title}
              </a>
            )
          })}
        </div>
      ))}
      <div className="ui-mobile-group">
        <a href="/pricing" className="ui-mobile-link" onClick={closeMobileNav}>
          Pricing
        </a>
      </div>
    </div>
  )
}
