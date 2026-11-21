"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Bell,
  BookOpen,
  ChevronsUpDown,
  CircleHelp,
  CircleUserRound,
  CreditCard,
  LogOut,
  Monitor,
  MonitorSmartphone,
  Moon,
  Settings,
  Sun,
  UserRound,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/components/ui/toast"
import { useMockSession } from "@/components/app/mock-session-provider"
import { NotificationPreferencesDialog } from "@/components/app/notification-preferences-dialog"
import { RevokeAllSessionsDialog } from "@/components/app/revoke-all-sessions-button"
import { useAppTheme } from "@/components/app/use-app-theme"
import type { AppThemeMode } from "@/components/app/app-theme"

/**
 * Avatar menu in the dashboard topbar. Shows the signed-in user's name and
 * email, links into account/billing/sessions settings plus docs and help, a
 * light/dark/system theme picker, a notification-preferences modal, and sign
 * out with toast feedback. Built on the shared Radix dropdown so keyboard
 * navigation, focus management, and dismissal match the workspace switcher.
 */
export function UserMenu() {
  const { user, signOut } = useMockSession()
  const { mode, setMode } = useAppTheme()
  const { toast } = useToast()
  const [revokeAllOpen, setRevokeAllOpen] = useState(false)
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false)
  const initial = user?.name?.trim().charAt(0).toUpperCase() ?? "?"
  const displayName = user?.name ?? "Account"

  function handleSignOut() {
    try {
      signOut()
      toast({
        title: "Signed out",
        description: "See you next time.",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't sign out",
        description: "Something went wrong. Please try again.",
        variant: "error",
      })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="app-account-trigger"
          aria-label={`${displayName} account menu`}
        >
          {/* The initial is rendered via CSS `content` so it stays decorative:
              axe's label-content-name-mismatch counts even aria-hidden text as
              visible, which would force the accessible name to repeat it. */}
          <span className="app-avatar" aria-hidden="true" data-initial={initial} />
          <span className="app-account-name">{displayName}</span>
          <ChevronsUpDown className="app-workspace-caret" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="app-menu">
          <DropdownMenuLabel className="app-menu-profile">
            <span className="app-avatar app-avatar--sm" aria-hidden="true" data-initial={initial} />
            <span className="app-menu-user-meta">
              <span className="app-menu-user-name">{displayName}</span>
              {user?.email ? <span className="app-menu-user-email">{user.email}</span> : null}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/app/profile">
              <UserRound aria-hidden="true" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/app/account">
              <CircleUserRound aria-hidden="true" />
              Account settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/app/settings">
              <Settings aria-hidden="true" />
              Workspace settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/dashboard/usage">
              <CreditCard aria-hidden="true" />
              Billing
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setNotifPrefsOpen(true)} className="app-menu-item">
            <Bell aria-hidden="true" />
            Notification preferences
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/app/sessions">
              <MonitorSmartphone aria-hidden="true" />
              Sessions
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/docs">
              <BookOpen aria-hidden="true" />
              Docs
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="app-menu-item">
            <Link href="/docs/faq">
              <CircleHelp aria-hidden="true" />
              Help
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="app-menu-section-label">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as AppThemeMode)}
            aria-label="Theme"
          >
            <DropdownMenuRadioItem value="light" className="app-menu-item">
              <Sun aria-hidden="true" />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className="app-menu-item">
              <Moon aria-hidden="true" />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" className="app-menu-item">
              <Monitor aria-hidden="true" />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setRevokeAllOpen(true)}
            className="app-menu-item"
            variant="destructive"
          >
            <LogOut aria-hidden="true" />
            Sign out everywhere
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={handleSignOut}
            className="app-menu-item"
            variant="destructive"
          >
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RevokeAllSessionsDialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen} />
      <NotificationPreferencesDialog open={notifPrefsOpen} onOpenChange={setNotifPrefsOpen} />
    </>
  )
}
