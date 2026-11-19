"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronsUpDown,
  Files,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
} from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useMockSession } from "@/components/app/mock-session-provider"

const THEME_KEY = "spindle-app-theme"

type NavItem = {
  label: string
  href: string
  icon: ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard aria-hidden="true" /> },
  { label: "Projects", href: "/projects", icon: <FolderKanban aria-hidden="true" /> },
  { label: "Files", href: "/app/files", icon: <Files aria-hidden="true" /> },
  { label: "Lab", href: "/app/lab", icon: <FlaskConical aria-hidden="true" /> },
  { label: "Chat", href: "/app/chat", icon: <MessageSquare aria-hidden="true" /> },
  { label: "Agent", href: "/app/agent", icon: <Bot aria-hidden="true" /> },
  { label: "Settings", href: "/app/settings", icon: <Settings aria-hidden="true" /> },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
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

function WorkspaceSwitcher() {
  const { workspace, workspaces, switchWorkspace } = useMockSession()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="app-workspace-trigger" aria-label="Switch workspace">
        <span className="app-workspace-name">{workspace?.name ?? "Workspace"}</span>
        <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="app-menu">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((option) => (
          <DropdownMenuItem
            key={option.slug}
            onSelect={() => switchWorkspace(option)}
            className="app-menu-item"
          >
            <span className="app-menu-item-label">{option.name}</span>
            {option.slug === workspace?.slug ? (
              <Check className="app-menu-check" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light")
    } catch {
      // Storage can be unavailable (private mode); the class still applies.
    }
  }

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

function SearchDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className="app-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search aria-hidden="true" />
        <span className="app-search-label">Search</span>
        <kbd className="app-search-kbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-overlay" />
        <DialogPrimitive.Content className="app-search-dialog" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <Input
            autoFocus
            placeholder="Search projects, files, and conversations…"
            aria-label="Search"
          />
          <p className="app-search-hint">
            Search is not wired up in the mock shell — this dialog is a placeholder for the real
            command palette.
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function AccountMenu() {
  const { user, signOut } = useMockSession()
  const initial = user?.name?.trim().charAt(0).toUpperCase() ?? "?"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="app-account-trigger" aria-label="Account menu">
        <span className="app-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="app-account-name">{user?.name ?? "Account"}</span>
        <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="app-menu">
        <DropdownMenuLabel>
          <span className="app-menu-user-name">{user?.name}</span>
          <span className="app-menu-user-email">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="app-menu-item">
          <Link href="/app/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="app-menu-item">
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Authenticated app shell: collapsible sidebar, top bar with workspace
 * switcher / search / account / theme controls, and a mobile drawer built on
 * Radix Dialog so it gets a focus trap and Escape handling for free.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
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
        <header className="app-topbar">
          <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                className="app-icon-button app-drawer-trigger"
                aria-label="Open navigation"
              >
                <Menu aria-hidden="true" />
              </button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="app-overlay" />
              <DialogPrimitive.Content className="app-drawer" aria-describedby={undefined}>
                <div className="app-drawer-head">
                  <DialogPrimitive.Title className="app-drawer-title">
                    Navigation
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close className="app-icon-button" aria-label="Close navigation">
                    <ChevronLeft aria-hidden="true" />
                  </DialogPrimitive.Close>
                </div>
                <nav aria-label="App navigation">
                  <NavList onNavigate={() => setDrawerOpen(false)} />
                </nav>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>

          <WorkspaceSwitcher />
          <div className="app-topbar-actions">
            <SearchDialog />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>
    </div>
  )
}
