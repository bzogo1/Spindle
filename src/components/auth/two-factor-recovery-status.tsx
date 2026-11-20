"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ShieldCheck, ShieldOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApiError, request } from "@/lib/api/client"

/**
 * Recovery status panel: polls `/api/auth/2fa/recovery/status` and renders
 * the current phase — awaiting the email token, cooling down until
 * `executeAt`, completed, or none. Offers Cancel while a recovery is
 * active; cancelling during cooldown is what keeps 2FA enabled.
 *
 * The GET finalizes a due recovery server-side, so the panel doubles as the
 * completion notice: once `state` becomes "completed" the user is told to
 * sign in again and re-enroll.
 */

type RecoveryStatus =
  | { state: "none" }
  | { state: "awaiting_token" }
  | { state: "cooldown"; executeAt: string | null; secondsRemaining: number }
  | { state: "completed"; enabled?: boolean }

const POLL_INTERVAL_MS = 30_000

function formatRemaining(seconds: number): string {
  const total = Math.max(0, seconds)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((total % 3_600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function TwoFactorRecoveryStatus() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await request<RecoveryStatus>("", "/api/auth/2fa/recovery/status", {
        method: "GET",
      })
      setStatus(data)
      setLoadError("")
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load recovery status.")
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load])

  // Tick the countdown display and re-poll while a recovery is active.
  useEffect(() => {
    const active = status?.state === "awaiting_token" || status?.state === "cooldown"
    if (!active) return
    timer.current = setInterval(() => {
      setNow(Date.now())
      void load()
    }, POLL_INTERVAL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }
  }, [status?.state, load])

  async function cancel() {
    setBusy(true)
    setActionError("")
    try {
      await request("", "/api/auth/2fa/recovery/cancel", { method: "POST", body: {} })
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't cancel the recovery.")
    } finally {
      setBusy(false)
    }
  }

  if (loadError && !status) {
    return (
      <div className="app-field">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint" role="alert">
          {loadError}
        </p>
        <div className="app-form-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="app-field">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint">Loading recovery status…</p>
      </div>
    )
  }

  if (status.state === "none") return null

  if (status.state === "awaiting_token") {
    return (
      <div className="app-field" aria-live="polite">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint">
          <ShieldCheck aria-hidden="true" /> A recovery is waiting for the emailed confirmation
          link. Two-factor authentication stays enabled until the link is confirmed and the 72-hour
          cooldown ends.
        </p>
        <div className="app-form-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void cancel()}
            disabled={busy}
          >
            Cancel recovery
          </Button>
        </div>
        {actionError ? (
          <p className="app-field-hint" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    )
  }

  if (status.state === "cooldown") {
    // Prefer the absolute executeAt so the countdown stays accurate between
    // polls; fall back to the server-reported secondsRemaining.
    const remaining = status.executeAt
      ? formatRemaining(Math.max(0, Math.ceil((Date.parse(status.executeAt) - now) / 1000)))
      : formatRemaining(status.secondsRemaining)
    return (
      <div className="app-field" aria-live="polite">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint">
          <ShieldOff aria-hidden="true" /> Recovery confirmed — two-factor authentication will be
          disabled in <strong>{remaining}</strong>. It stays enabled until then; if you didn&apos;t
          request this, cancel now.
        </p>
        <div className="app-form-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void cancel()}
            disabled={busy}
          >
            {busy ? "Cancelling…" : "Cancel recovery"}
          </Button>
        </div>
        {actionError ? (
          <p className="app-field-hint" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    )
  }

  if (status.state === "completed") {
    return (
      <div className="app-field" aria-live="polite">
        <span className="app-field-label">Two-factor recovery</span>
        <p className="app-field-hint">
          <ShieldOff aria-hidden="true" /> Two-factor authentication was disabled by the recovery
          flow. Sign in again with your password and re-enable two-factor authentication from this
          section.
        </p>
      </div>
    )
  }

  return null
}
