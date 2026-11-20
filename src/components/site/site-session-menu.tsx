"use client"

import { useState } from "react"
import Link from "next/link"
import { CircleUserRound, LayoutDashboard, LogOut, MailCheck } from "lucide-react"

import { useAuthSession } from "@/components/auth/session-provider"
import { useLanguage } from "@/components/i18n/language-provider"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { requestEmailVerification } from "@/lib/auth/auth-client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { APP_DASHBOARD_PATH } from "@/lib/auth/mock-session"

/**
 * Header session slot. While the first session resolution is in flight it
 * renders a small placeholder so the header doesn't shift; signed-out
 * visitors get a link to the standalone sign-in page; signed-in users get a
 * dropdown into the app shell.
 */
export function SiteSessionMenu() {
  const { user, status, signOut } = useAuthSession()
  const { t } = useLanguage()
  const [verificationPending, setVerificationPending] = useState(false)

  const handleVerifyEmail = async () => {
    if (!user?.email || verificationPending) return
    setVerificationPending(true)
    try {
      await requestEmailVerification(user.email)
      toast.success(t("toast.verificationSent"), {
        description: t("toast.verificationSentHint", { email: user.email }),
      })
    } catch (error) {
      toast.error(t("toast.verificationFailed"), {
        description: error instanceof Error ? error.message : t("toast.tryAgain"),
      })
    } finally {
      setVerificationPending(false)
    }
  }

  if (status === "loading") {
    return (
      <span
        className="sign-in"
        aria-hidden="true"
        style={{ display: "inline-block", width: "72px", height: "1em" }}
      />
    )
  }

  if (status !== "authenticated" || !user) {
    return (
      <Button asChild variant="link" className="ui-signin-trigger">
        <Link href="/sign-in">{t("auth.signIn")}</Link>
      </Button>
    )
  }

  const displayName = user.name?.trim() || user.email
  const initial = (user.name?.trim().charAt(0) || user.email.charAt(0)).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="link" className="ui-signin-trigger" aria-label={t("auth.accountMenu")}>
          <span aria-hidden="true">{initial}</span>
          <span>{displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="ui-menu">
        <DropdownMenuLabel className="ui-menu-label">
          <span>{displayName}</span>
          {user.email ? <span>{user.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="ui-menu-separator" />
        <DropdownMenuItem asChild className="ui-menu-item">
          <Link href={APP_DASHBOARD_PATH}>
            <LayoutDashboard aria-hidden="true" />
            {t("auth.openApp")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="ui-menu-item">
          <Link href="/app/account">
            <CircleUserRound aria-hidden="true" />
            {t("auth.accountSettings")}
          </Link>
        </DropdownMenuItem>
        {user.emailVerified === false ? (
          <DropdownMenuItem
            className="ui-menu-item"
            disabled={verificationPending}
            onSelect={() => {
              void handleVerifyEmail()
            }}
          >
            <MailCheck aria-hidden="true" />
            {verificationPending ? t("auth.sendingVerification") : t("auth.verifyEmail")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator className="ui-menu-separator" />
        <DropdownMenuItem
          className="ui-menu-item"
          variant="destructive"
          onSelect={() => {
            void signOut()
          }}
        >
          <LogOut aria-hidden="true" />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
