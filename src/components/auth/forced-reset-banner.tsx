"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ShieldAlert } from "lucide-react"

/**
 * App-wide banner shown while the signed-in user's account carries the
 * forced-password-reset flag (`GET /api/auth/forced-reset/status`).
 *
 * The flag is normally enforced at sign-in (`/api/auth/signin` refuses to
 * issue a session), so this banner mainly covers the window where an admin
 * flags an already-signed-in user: it stays visible on every app page until
 * the user completes `/reset-password` → email link →
 * `/api/auth/password/reset/confirm`, which is the only path that clears
 * the flag. The status is re-checked on window focus so clearing the flag
 * (or an admin lifting it) dismisses the banner without a reload.
 *
 * Renders nothing while the check is pending, when the endpoint is
 * unreachable, or when the user is signed out — never blocks the UI.
 */
export function ForcedResetBanner() {
  const [required, setRequired] = useState(false)

  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/forced-reset/status", {
        credentials: "same-origin",
      })
      if (!response.ok) {
        setRequired(false)
        return
      }
      const data = (await response.json()) as { ok?: boolean; required?: boolean }
      setRequired(data.ok === true && data.required === true)
    } catch {
      // Network failure or non-JSON body: treat as "not required" — the
      // signin enforcement is the real gate, the banner is only a nudge.
      setRequired(false)
    }
  }, [])

  useEffect(() => {
    void check()
    window.addEventListener("focus", check)
    return () => window.removeEventListener("focus", check)
  }, [check])

  if (!required) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-50 px-4 py-2.5 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-50"
    >
      <ShieldAlert aria-hidden="true" className="size-4 flex-none" />
      <p className="text-sm">
        <strong>Password reset required.</strong> Your account must set a new password before
        continuing.{" "}
        <Link href="/reset-password" className="font-semibold underline underline-offset-2">
          Reset your password
        </Link>
      </p>
    </div>
  )
}
