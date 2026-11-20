"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, KeyRound, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { request } from "@/lib/api/client"

/**
 * Backup-code manager for the account security (2FA) section.
 *
 * Talks to `/api/auth/2fa/backup-codes`: GET reports whether a managed set
 * exists and how many unused codes remain; POST regenerates and returns the
 * plaintext codes exactly once — they are shown here and never again.
 *
 * Regenerating invalidates every previously issued code, including the set
 * shown at enrollment, so the flow always goes through an explicit confirm
 * step. The panel fails soft: if the status request fails it shows a retry
 * instead of breaking the surrounding settings card.
 */

export type BackupCodesStatus = {
  /** Whether TOTP two-factor is enabled for the account (from GET). */
  enabled: boolean
  managed: boolean
  remaining: number | null
}

type GeneratedCodes = {
  backupCodes: string[]
  remaining: number
}

type LoadState = "loading" | "ready" | "error"

const COPIED_RESET_MS = 2000

export function BackupCodesPanel() {
  const [status, setStatus] = useState<BackupCodesStatus | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [codes, setCodes] = useState<string[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState("")
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const load = useCallback(async () => {
    setLoadState("loading")
    try {
      const data = await request<BackupCodesStatus>("", "/api/auth/2fa/backup-codes")
      setStatus({
        enabled: data.enabled,
        managed: data.managed,
        remaining: data.remaining,
      })
      setLoadState("ready")
    } catch {
      setLoadState("error")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function generate() {
    setBusy(true)
    setActionError("")
    try {
      const data = await request<GeneratedCodes>("", "/api/auth/2fa/backup-codes", {
        method: "POST",
      })
      setCodes(data.backupCodes)
      setStatus({ enabled: true, managed: true, remaining: data.remaining })
      setConfirming(false)
    } catch {
      setActionError("Couldn't generate backup codes. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function copyAll() {
    if (!codes) return
    try {
      await navigator.clipboard.writeText(codes.join("\n"))
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch {
      setCopied(false)
    }
  }

  function dismissCodes() {
    // Plaintext codes are never retrievable — dismissing ends the one-time view.
    setCodes(null)
    setCopied(false)
  }

  if (loadState === "loading") {
    return (
      <div className="app-field">
        <span className="app-field-label">Backup codes</span>
        <p className="app-field-hint">Loading backup codes…</p>
      </div>
    )
  }

  if (codes) {
    return (
      <div className="app-2fa-setup" aria-live="polite">
        <p>
          <strong>Save these backup codes now.</strong> Each one works once and this is the only
          time they are shown.
        </p>
        <ul className="app-recovery-codes">
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <p className="app-field-hint">
          Store them somewhere safe — a password manager or printed sheet. Anyone with a code can
          use it to sign in if they also have your password.
        </p>
        {actionError ? (
          <p className="app-field-hint" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="app-form-actions">
          <Button type="button" variant="outline" onClick={copyAll}>
            {copied ? <Check aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
            {copied ? "Copied" : "Copy all codes"}
          </Button>
          <Button type="button" onClick={dismissCodes}>
            I&apos;ve saved my codes
          </Button>
        </div>
      </div>
    )
  }

  if (loadState === "error") {
    return (
      <div className="app-field">
        <span className="app-field-label">Backup codes</span>
        <p className="app-field-hint" role="alert">
          Backup codes could not be loaded.
        </p>
        <div className="app-form-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const remaining = status?.remaining ?? null
  const managed = status?.managed ?? false

  return (
    <div className="app-field">
      <span className="app-field-label">Backup codes</span>
      <p className="app-field-hint">
        {managed
          ? `${remaining} unused backup ${remaining === 1 ? "code" : "codes"} remaining. Each code works once at sign-in when your authenticator is unavailable.`
          : "No backup codes managed here yet. Codes are also issued when you enable two-factor authentication; generating a set here replaces it."}
      </p>

      {confirming ? (
        <div className="app-field">
          <p className="app-field-hint">
            <ShieldAlert aria-hidden="true" /> Generating a new set immediately invalidates every
            previously issued backup code — including the ones shown at setup. Continue?
          </p>
          <div className="app-form-actions">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void generate()} disabled={busy}>
              {busy ? "Generating…" : managed ? "Regenerate codes" : "Generate codes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="app-form-actions">
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            <KeyRound aria-hidden="true" />
            {managed ? "Regenerate backup codes" : "Generate backup codes"}
          </Button>
        </div>
      )}

      {actionError ? (
        <p className="app-field-hint" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  )
}
