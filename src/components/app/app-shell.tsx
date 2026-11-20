"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { ChevronLeft, Menu, Moon, Search, Sun } from "lucide-react"

import { Toaster } from "@/components/ui/toast"
import { useAppTheme } from "@/components/app/use-app-theme"
import { UserMenu } from "@/components/app/user-menu"
import { WorkspaceSwitcher } from "@/components/workspaces/workspace-switcher"
import { NAV_ITEMS } from "@/components/app/nav-items"
import { MobileNavDrawer } from "@/components/app/mobile-nav-drawer"
import { KeyboardShortcuts } from "@/components/app/keyboard-shortcuts"
import { MessagesBell } from "./messages-bell"
import { NotificationBell } from "./notification-bell"
import { ForcedResetBanner } from "@/components/auth/forced-reset-banner"
import { ImpersonationBanner } from "@/components/admin/impersonation-banner"

/**
 * The ⌘K palette and its search providers are the heaviest part of the app
 * shell, so they load as a separate client chunk after hydration instead of
 * riding in the shell's initial bundle. `ssr: false` is allowed here because
 * AppShell is a Client Component. The loading fallback renders the same
 * trigger button so the top bar does not shift while the chunk arrives.
 */
const CommandMenu = dynamic(
  () => import("@/components/app/command-menu").then((mod) => mod.CommandMenu),
  {
    ssr: false,
    loading: () => (
      <button type="button" className="app-search-trigger">
        <Search aria-hidden="true" />
        <span className="app-search-label">Search</span>
        <kbd className="app-search-kbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
    ),
  },
)

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Title shown in the top bar for the current section. */
function pageTitle(pathname: string) {
  if (pathname.startsWith("/projects/")) return "Project"
  return NAV_ITEMS.find((item) => isActive(pathname, item.href))?.label ?? "Spindle"
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <ul className="app-nav-list">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className="app-nav-link"
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
            >
              <span className="app-nav-icon">{item.icon}</span>
              <span className="app-nav-label">{item.label}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function Brand() {
  return (
    <Link href="/dashboard" className="app-brand" aria-label="Spindle app home">
      <span className="app-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="8" cy="22" r="2.2" fill="currentColor" />
        </svg>
      </span>
      <span className="app-brand-name">spindle</span>
    </Link>
  )
}

function ThemeToggle() {
  const { dark, toggle } = useAppTheme()

  return (
    <button
      type="button"
      className="app-icon-button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  )
}

/**
 * Authenticated app shell: collapsible sidebar, top bar with workspace
 * switcher / search / account / theme controls, and a mobile drawer built on
 * Radix Dialog so it gets a focus trap and Escape handling for free.
 */
/**
 * Polite live region announcing client-side route changes to screen readers
 * (WCAG 4.1.3 Status Messages). Skips the initial render so page load is not
 * announced twice.
 */
function RouteAnnouncer() {
  const pathname = usePathname()
  const [announcement, setAnnouncement] = useState("")
  const previousPathname = useRef(pathname)

  useEffect(() => {
    if (previousPathname.current === pathname) return
    previousPathname.current = pathname
    setAnnouncement(`Navigated to ${pageTitle(pathname)}`)
  }, [pathname])

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className={`app-shell${collapsed ? "is-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <div className="app-sidebar-head">
          <Brand />
          <button
            type="button"
            className="app-icon-button app-sidebar-collapse"
            onClick={() => setCollapsed((current) => !current)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        </div>
        <nav className="app-sidebar-nav" aria-label="App navigation">
          <NavList />
        </nav>
      </aside>

      <div className="app-body-col">
        {/* Self-fetching: renders only while an admin impersonation is live. */}
        <ImpersonationBanner />
        <ForcedResetBanner />
        <header className="app-topbar">
          <MobileNavDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            trigger={
              <button
                type="button"
                className="app-icon-button app-drawer-trigger"
                aria-label="Open navigation"
              >
                <Menu aria-hidden="true" />
              </button>
            }
          >
            <div className="app-drawer-brand">
              <Brand />
            </div>
            <nav aria-label="App navigation">
              <NavList onNavigate={() => setDrawerOpen(false)} />
            </nav>
          </MobileNavDrawer>

          <span className="app-topbar-title">{pageTitle(pathname)}</span>

          <WorkspaceSwitcher />
          <div className="app-topbar-actions">
            <CommandMenu />
            <NotificationBell />
            <MessagesBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="app-content">
          {children}
        </main>
      </div>
      <RouteAnnouncer />
      <KeyboardShortcuts />
      <Toaster />
    </div>
  )
}
