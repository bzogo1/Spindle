"use client"

import { useState } from "react"
import { ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { request } from "@/lib/api/client"
import { useMockSession } from "@/components/app/mock-session-provider"

/**
 * "Sign out everywhere" — revokes every session for the account.
 *
 * `RevokeAllSessionsDialog` is the controlled confirmation dialog: it POSTs
 * to `/api/auth/sessions/revoke-all` (which revokes all sessions server-side
 * and clears the auth cookies), then calls the session's `signOut()` so the
 * local session state is dropped and the app navigates back to a signed-out
 * view. Failures keep the dialog open with an inline error so the user can
 * retry or cancel.
 *
 * `RevokeAllSessionsButton` is the self-contained trigger for surfaces that
 * aren't already inside a menu (e.g. the account security section); the
 * user menu drives `RevokeAllSessionsDialog` directly because a dropdown
 * item cannot host a nested button.
 */

const REVOKE_ALL_API = "/api/auth/sessions/revoke-all"

export function RevokeAllSessionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { signOut } = useMockSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function confirm() {
    setBusy(true)
    setError("")
    try {
      await request<{ revoked?: boolean }>("", REVOKE_ALL_API, { method: "POST", body: {} })
      // The server already cleared the auth cookies; signOut() drops local
      // session state and navigates to the signed-out landing page.
      signOut()
    } catch {
      setError("Couldn't sign out everywhere. Check your connection and try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setError("")
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign out everywhere?</DialogTitle>
          <DialogDescription>
            This signs you out on <strong>every device</strong>, including this one. You will need
            to sign in again on each device. Use this if you think someone else may have access to
            your account.
          </DialogDescription>
        </DialogHeader>

        <p className="app-field-hint">
          <ShieldAlert aria-hidden="true" /> This cannot be undone — all sessions are revoked
          immediately.
        </p>

        {error ? (
          <p className="app-field-hint" role="alert">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? "Signing out…" : "Sign out everywhere"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RevokeAllSessionsButton({
  children = "Sign out everywhere",
  ...buttonProps
}: React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)} {...buttonProps}>
        {children}
      </Button>
      <RevokeAllSessionsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
