"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, KeyRound, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { request } from "@/lib/api/client"

/**
 * Emergency access (break-glass) code manager for account settings.
 *
 * Talks to `/api/auth/emergency-codes`: GET reports how many unused codes
 * remain and when the set expires; POST regenerates and returns the plaintext
 * codes exactly once — they are shown here and never again; DELETE revokes
 * the whole set.
 *
 * Unlike TOTP backup codes these are NOT tied to two-factor: they are the
 * last-resort recovery path when normal sign-in, 2FA, and email recovery all
 * fail. A redeemed code never creates a sign-in session — it only unlocks a
 * restricted flow that forces a password reset.
 *
 * The panel fails soft: if the status request fails it shows a retry instead
 * of breaking the surrounding settings card.
 */

export type EmergencyCodesStatus = {
  active: boolean
  remaining: number | null
  expiresAt: string | null
}

type GeneratedCodes = {
  emergencyCodes: string[]
  remaining: number
  expiresAt: string
}

type LoadState = "loading" | "ready" | "error"

const COPIED_RESET_MS = 2000

function normalizeStatus(data: Partial<EmergencyCodesStatus>): EmergencyCodesStatus {
  return {
    active: data.active === true,
    remaining: typeof data.remaining === "number" ? data.remaining : null,
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
  }
}

export function EmergencyCodesPanel() {
  const [status, setStatus] = useState<EmergencyCodesStatus | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [codes, setCodes] = useState<string[] | null>(null)
  const [confirming, setConfirming] = useState<"generate" | "revoke" | null>(null)
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
      const data = await request<Partial<EmergencyCodesStatus>>("", "/api/auth/emergency-codes")
      setStatus(normalizeStatus(data))
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
      const data = await request<GeneratedCodes>("", "/api/auth/emergency-codes", {
        method: "POST",
      })
      setCodes(data.emergencyCodes)
      setStatus({
        active: true,
        remaining: data.remaining,
        expiresAt: data.expiresAt,
      })
      setConfirming(null)
    } catch {
      setActionError("Couldn't generate emergency codes. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    setBusy(true)
    setActionError("")
    try {
      await request("", "/api/auth/emergency-codes", { method: "DELETE" })
      setStatus({ active: false, remaining: null, expiresAt: null })
      setConfirming(null)
    } catch {
      setActionError("Couldn't revoke emergency codes. Please try again.")
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
        <span className="app-field-label">Emergency access codes</span>
        <p className="app-field-hint">Loading emergency codes…</p>
      </div>
    )
  }

  if (codes) {
    return (
      <div className="app-2fa-setup" aria-live="polite">
        <p>
          <strong>Save these emergency codes now.</strong> Each one works once, this is the only
          time they are shown, and using one signs out every device on your account.
        </p>
        <ul className="app-recovery-codes">
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <p className="app-field-hint">
          Store them somewhere safe and offline — a password manager or printed sheet. Anyone with a
          code and your email can force a password reset on your account.
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
        <span className="app-field-label">Emergency access codes</span>
        <p className="app-field-hint" role="alert">
          Emergency codes could not be loaded.
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
  const active = status?.active ?? false
  const expiresAt = status?.expiresAt ? new Date(status.expiresAt) : null

  return (
    <div className="app-field">
      <span className="app-field-label">Emergency access codes</span>
      <p className="app-field-hint">
        {active && remaining !== null
          ? `${remaining} unused emergency ${remaining === 1 ? "code" : "codes"} remaining${expiresAt ? `, expiring ${expiresAt.toLocaleDateString()}` : ""}. Each code works once at /emergency-access to force a password reset when you are locked out.`
          : "No emergency codes yet. These break-glass codes recover your account when password reset, two-factor, and email recovery all fail — they are not needed for normal sign-in."}
      </p>

      {confirming === "generate" ? (
        <div className="app-field">
          <p className="app-field-hint">
            <ShieldAlert aria-hidden="true" /> Generating a new set immediately invalidates every
            previously issued emergency code. Continue?
          </p>
          <div className="app-form-actions">
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void generate()} disabled={busy}>
              {busy ? "Generating…" : active ? "Regenerate codes" : "Generate codes"}
            </Button>
          </div>
        </div>
      ) : confirming === "revoke" ? (
        <div className="app-field">
          <p className="app-field-hint">
            <ShieldAlert aria-hidden="true" /> This immediately invalidates every emergency code.
            You will not be able to undo this. Continue?
          </p>
          <div className="app-form-actions">
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void revoke()}
              disabled={busy}
            >
              {busy ? "Revoking…" : "Revoke all codes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="app-form-actions">
          <Button type="button" variant="outline" onClick={() => setConfirming("generate")}>
            <KeyRound aria-hidden="true" />
            {active ? "Regenerate emergency codes" : "Generate emergency codes"}
          </Button>
          {active ? (
            <Button type="button" variant="outline" onClick={() => setConfirming("revoke")}>
              Revoke all
            </Button>
          ) : null}
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
