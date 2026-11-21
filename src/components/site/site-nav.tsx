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
import { useLanguage } from "@/components/i18n/language-provider"
import { SITE_SEARCH_OPEN_EVENT } from "@/lib/site-search"
import { cn } from "@/lib/utils"

import styles from "./site-command-menu.module.css"

/* One link source drives the desktop menus and the mobile panel.
 *
 * Link copy is translated: `id` maps to `nav.link.<id>` (title) and
 * `nav.link.<id>.desc` (description) in the i18n dictionaries. */

type NavLinkItem = {
  id: string
  href: string
  icon: LucideIcon
}

const productLinks: NavLinkItem[] = [
  {
    id: "workspaceOverview",
    href: "/workspace",
    icon: Layers3,
  },
  {
    id: "files",
    href: "/files",
    icon: FolderOpen,
  },
  {
    id: "lab",
    href: "/lab",
    icon: FlaskConical,
  },
  {
    id: "labPreview",
    href: "/lab-notebook-preview",
    icon: NotebookPen,
  },
  {
    id: "localSearch",
    href: "/search",
    icon: Search,
  },
  {
    id: "automations",
    href: "/automations",
    icon: Workflow,
  },
  {
    id: "agent",
    href: "/agent",
    icon: Bot,
  },
  {
    id: "teamChat",
    href: "/collaboration#chat",
    icon: MessagesSquare,
  },
  {
    id: "collaboration",
    href: "/collaboration",
    icon: Users,
  },
  {
    id: "infrastructure",
    href: "/infrastructure",
    icon: ShieldCheck,
  },
  {
    id: "allFeatures",
    href: "/platform",
    icon: Sparkles,
  },
]

const solutionLinks: NavLinkItem[] = [
  {
    id: "researchers",
    href: "/solutions/researchers",
    icon: NotebookPen,
  },
  {
    id: "labs",
    href: "/solutions/labs",
    icon: FlaskConical,
  },
  {
    id: "teams",
    href: "/solutions/teams",
    icon: Users,
  },
  {
    id: "institutions",
    href: "/solutions/institutions",
    icon: Building2,
  },
]

const resourceLinks: NavLinkItem[] = [
  {
    id: "documentation",
    href: "/docs",
    icon: BookOpen,
  },
  {
    id: "quickstart",
    href: "/docs/quickstart",
    icon: Zap,
  },
  {
    id: "guides",
    href: "/docs/guides",
    icon: FileText,
  },
  {
    id: "changelog",
    href: "/changelog",
    icon: Newspaper,
  },
  {
    id: "faq",
    href: "/docs/faq",
    icon: CircleHelp,
  },
]

const companyLinks: NavLinkItem[] = [
  {
    id: "about",
    href: "/about",
    icon: Sparkles,
  },
  {
    id: "contact",
    href: "/contact",
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
  const { t } = useLanguage()
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
            <span className="ui-nav-card-title">{t(`nav.link.${link.id}`)}</span>
            <span className="ui-nav-card-desc">{t(`nav.link.${link.id}.desc`)}</span>
          </span>
        </a>
      </NavigationMenuLink>
    </li>
  )
}

function NavGroup({
  labelKey,
  links,
  path,
  hash,
  wide = false,
}: {
  labelKey: string
  links: NavLinkItem[]
  path: string
  hash: string
  wide?: boolean
}) {
  const { t } = useLanguage()
  const hasCurrent = links.some((link) => isCurrentLink(link.href, path, hash))

  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger className={cn("ui-nav-trigger", hasCurrent && "is-current")}>
        {t(labelKey)}
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
  const { t } = useLanguage()
  const pricingCurrent = isCurrentLink("/pricing", path, hash)

  return (
    <NavigationMenu className="ui-main-nav" aria-label="Main navigation">
      <NavigationMenuList className="ui-nav-list">
        <NavGroup labelKey="nav.product" links={productLinks} path={path} hash={hash} wide />
        <NavGroup labelKey="nav.solutions" links={solutionLinks} path={path} hash={hash} />
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
              {t("nav.pricing")}
            </a>
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavGroup labelKey="nav.resources" links={resourceLinks} path={path} hash={hash} />
        <NavGroup labelKey="nav.company" links={companyLinks} path={path} hash={hash} />
      </NavigationMenuList>
      <NavigationMenuIndicator />
    </NavigationMenu>
  )
}

const mobileGroups = [
  { labelKey: "nav.product", links: productLinks },
  { labelKey: "nav.solutions", links: solutionLinks },
  { labelKey: "nav.resources", links: resourceLinks },
  { labelKey: "nav.company", links: companyLinks },
]

export function MobileNav() {
  const { path, hash } = useSiteLocation()
  const { t } = useLanguage()
  const pricingCurrent = isCurrentLink("/pricing", path, hash)

  // The toggle button lives in the header; script.js owns its open state.
  function closeMobileNav() {
    document.getElementById("mobileNav")?.classList.remove("open")
    const toggle = document.getElementById("menuToggle")
    toggle?.setAttribute("aria-expanded", "false")
    toggle?.setAttribute("aria-label", t("nav.openMenu"))
  }

  /* Mobile devices have no ⌘K — the palette opens via the header's
     SiteCommandMenu listening for this event. */
  function openSiteSearch() {
    closeMobileNav()
    window.dispatchEvent(new Event(SITE_SEARCH_OPEN_EVENT))
  }

  return (
    <div className="ui-mobile-nav">
      <div className="ui-mobile-group">
        <button type="button" className={styles.mobileSearch} onClick={openSiteSearch}>
          <Search className="size-3.5" aria-hidden="true" />
          {t("nav.searchSite")}
        </button>
      </div>
      {mobileGroups.map((group) => (
        <div className="ui-mobile-group" key={group.labelKey}>
          <p className="ui-mobile-group-label">{t(group.labelKey)}</p>
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
                {t(`nav.link.${link.id}`)}
              </a>
            )
          })}
        </div>
      ))}
      <div className="ui-mobile-group">
        <a
          href="/pricing"
          className={cn("ui-mobile-link", pricingCurrent && "is-current")}
          aria-current={pricingCurrent ? "page" : undefined}
          onClick={closeMobileNav}
        >
          {t("nav.pricing")}
        </a>
      </div>
      {/* The header hides its "Start free" button on phone widths, so the
          primary CTA lives here instead. */}
      <div className="ui-mobile-group">
        <a href="/sign-up" className="btn btn--primary btn--full" onClick={closeMobileNav}>
          {t("auth.startFree")}
        </a>
      </div>
    </div>
  )
}
