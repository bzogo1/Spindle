"use client"

import { useState, type FormEvent } from "react"
import { ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, request } from "@/lib/api/client"

/**
 * Landing view for the emailed recovery link (`/two-factor-recovery?token=…`).
 *
 * POSTs `/api/auth/2fa/recovery/confirm` with the single-use token. On
 * success the recovery enters its 72-hour cooldown — 2FA remains enabled and
 * cancellable until then — and this view switches to the status summary.
 * An optional backup code field adds proof-of-possession on top of the email
 * token for users who still have their codes.
 */

type ConfirmResponse = {
  state?: string
  executeAt?: string | null
}

type ViewState = "form" | "confirming" | "scheduled" | "error"

export function TwoFactorRecoveryConfirm({ token }: { token: string }) {
  const [backupCode, setBackupCode] = useState("")
  const [view, setView] = useState<ViewState>("form")
  const [error, setError] = useState("")
  const [executeAt, setExecuteAt] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (view === "confirming") return
    setView("confirming")
    setError("")
    try {
      const data = await request<ConfirmResponse>("", "/api/auth/2fa/recovery/confirm", {
        method: "POST",
        body: {
          token,
          ...(backupCode.trim() ? { backupCode: backupCode.trim() } : {}),
        },
      })
      setExecuteAt(data.executeAt ?? null)
      setView("scheduled")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm the recovery.")
      setView("error")
    }
  }

  if (view === "scheduled") {
    return (
      <div className="app-field" aria-live="polite">
        <span className="app-field-label">Recovery scheduled</span>
        <p className="app-field-hint">
          <ShieldCheck aria-hidden="true" /> Your identity is verified. Two-factor authentication
          stays enabled for a 72-hour cooldown
          {executeAt ? ` (until ${new Date(executeAt).toLocaleString()})` : ""} and will then be
          disabled automatically. If this wasn&apos;t you, cancel the recovery from your security
          settings — or sign in with a backup code and turn it off there.
        </p>
      </div>
    )
  }

  return (
    <form
      className="auth-form"
      onSubmit={handleSubmit}
      aria-busy={view === "confirming"}
      noValidate
    >
      {error ? (
        <p className="auth-form-alert" role="alert">
          {error}
        </p>
      ) : null}
      <p className="auth-hint">
        Confirming starts a 72-hour cooldown after which two-factor authentication is disabled. You
        can cancel at any time before it completes.
      </p>
      <div className="ui-field">
        <Label htmlFor="recovery-backup-code">Backup code (optional)</Label>
        <Input
          id="recovery-backup-code"
          name="backupCode"
          autoComplete="off"
          placeholder="XXXX-XXXX"
          value={backupCode}
          onChange={(event) => setBackupCode(event.target.value)}
        />
        <p className="auth-hint">Only needed if you want extra proof — leave blank otherwise.</p>
      </div>
      <Button type="submit" className="ui-btn-primary auth-submit" disabled={view === "confirming"}>
        {view === "confirming" ? (
          <>
            <span className="auth-spinner" aria-hidden="true" /> Confirming…
          </>
        ) : (
          "Confirm recovery"
        )}
      </Button>
    </form>
  )
}
