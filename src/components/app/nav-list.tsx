"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronDown, Clock3 } from "lucide-react"

import {
  isNavActive,
  NAV_GROUPS,
  type NavEntry,
  type NavGroup,
} from "@/components/app/nav-items"
import { useRecentPages } from "@/components/app/use-recent-pages"

/**
 * Sidebar / drawer navigation: a "Recent" section with the last visited pages
 * followed by collapsible {@link NAV_GROUPS}. Group headers are buttons with
 * `aria-expanded`; hovering or focusing a link calls `router.prefetch` so the
 * target route's RSC payload is already warm on click.
 */

function prefetchHref(router: ReturnType<typeof useRouter>, href: string) {
  // `prefetch` is always present on the real AppRouterInstance; the optional
  // call keeps minimal test mocks of next/navigation working.
  router.prefetch?.(href)
}

function NavLink({
  item,
  depth = 0,
  onNavigate,
}: {
  item: NavEntry
  depth?: number
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const active = isNavActive(pathname, item.href)

  return (
    <li>
      <Link
        href={item.href}
        className="app-nav-link"
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        onMouseEnter={() => prefetchHref(router, item.href)}
        onFocus={() => prefetchHref(router, item.href)}
        style={depth > 0 ? { paddingLeft: `${10 + depth * 14}px` } : undefined}
      >
        <span className="app-nav-icon">{item.icon}</span>
        <span className="app-nav-label">{item.label}</span>
      </Link>
      {item.children && item.children.length > 0 ? (
        <ul className="app-nav-list">
          {item.children.map((child) => (
            <NavLink key={child.href} item={child} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function groupContainsPath(group: NavGroup, pathname: string): boolean {
  const matches = (item: NavEntry): boolean =>
    isNavActive(pathname, item.href) || (item.children?.some(matches) ?? false)
  return group.items.some(matches)
}

function NavGroupSection({
  group,
  onNavigate,
}: {
  group: NavGroup
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const containsActive = groupContainsPath(group, pathname)
  // Groups start open when they hold the current page; the effect re-opens
  // them on client-side navigation into the group.
  const [open, setOpen] = useState(containsActive)
  useEffect(() => {
    if (containsActive) setOpen(true)
  }, [containsActive])

  return (
    <li>
      <button
        type="button"
        className="app-nav-link w-full text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="app-nav-icon">{group.icon}</span>
        <span className="app-nav-label">{group.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open ? (
        <ul className="app-nav-list">
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function RecentPages() {
  const pages = useRecentPages()
  if (pages.length === 0) return null

  return (
    <div className="mb-3">
      <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Recent
      </p>
      <ul className="app-nav-list">
        {pages.map((page) => (
          <NavLink
            key={page.href}
            item={{ label: page.label, href: page.href, icon: <Clock3 aria-hidden="true" /> }}
          />
        ))}
      </ul>
    </div>
  )
}

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <RecentPages />
      <ul className="app-nav-list">
        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.label} group={group} onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  )
}
