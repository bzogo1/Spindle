"use client"

import { useCallback, useEffect, useState } from "react"
import { VenetianMask } from "lucide-react"

import { Button } from "@/components/ui/button"
import { acceptSession, type ClientSession } from "@/lib/auth/auth-client"

/**
 * Fixed banner shown while an admin impersonation session is active.
 *
 * Mounting: rendered once by `AppShell` (self-fetching mode) so it follows
 * the admin across every page — including the moment impersonation starts,
 * when `/app/admin/*` becomes unreachable for the impersonated (non-admin)
 * session. It is the ONLY banner: `ImpersonationPanel` deliberately does not
 * render a second one.
 *
 * Self-sufficient: with no props it polls `GET
 * /api/auth/admin/impersonate/status` on mount, every
 * `STATUS_POLL_INTERVAL_MS`, and whenever `IMPERSONATION_STATUS_EVENT` is
 * dispatched (e.g. right after the admin page starts a session), so the
 * banner reflects reality — it disappears when the record expires, is
 * stopped elsewhere, or the admin session is silently restored by a
 * refresh. Renders nothing when no impersonation is active. `onStopped`
 * runs after a successful stop (default: full page reload so every server
 * component re-resolves the restored admin session).
 */

export interface ImpersonationInfo {
  id: string
  adminEmail?: string
  targetEmail: string
  targetName?: string | null
  startedAt: string
  expiresAt: string
  endedAt?: string | null
  endReason?: string | null
}

interface StatusResponse {
  ok: boolean
  active?: boolean
  impersonation?: ImpersonationInfo | null
}

interface StopResponse {
  ok?: boolean
  message?: string
  /** Restored admin session description, when the stop route provides it. */
  session?: ClientSession | null
}

const STATUS_URL = "/api/auth/admin/impersonate/status"
const STOP_URL = "/api/auth/admin/impersonate/stop"
/** How often self-fetching mode re-checks status (expiry, external stop). */
const STATUS_POLL_INTERVAL_MS = 30_000

/**
 * Window event dispatched when impersonation state changes outside this
 * component (e.g. `ImpersonationPanel` just started a session). Self-fetching
 * mode listens and re-checks status immediately instead of waiting for the
 * next poll.
 */
export const IMPERSONATION_STATUS_EVENT = "spindle:impersonation-status-changed"

export function ImpersonationBanner({
  impersonation: impersonationProp,
  onStopped,
}: {
  /** Pass `null` to force-hide, `undefined` to self-fetch status. */
  impersonation?: ImpersonationInfo | null
  onStopped?: () => void
} = {}) {
  const [fetched, setFetched] = useState<ImpersonationInfo | null>(null)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selfFetching = impersonationProp === undefined

  useEffect(() => {
    if (!selfFetching) return
    let cancelled = false
    const check = async () => {
      try {
        const response = await fetch(STATUS_URL, { cache: "no-store" })
        const data = (await response.json()) as StatusResponse
        if (cancelled) return
        setFetched(
          response.ok && data.ok && data.active && data.impersonation ? data.impersonation : null,
        )
      } catch {
        // Banner is best-effort; a failed status check keeps the last state.
      }
    }
    void check()
    const timer = setInterval(() => void check(), STATUS_POLL_INTERVAL_MS)
    const onStatusChanged = () => void check()
    window.addEventListener(IMPERSONATION_STATUS_EVENT, onStatusChanged)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener(IMPERSONATION_STATUS_EVENT, onStatusChanged)
    }
  }, [selfFetching])

  // All hooks must run before the early return below — the banner mounts
  // and unmounts its content as impersonation state changes.
  const stop = useCallback(async () => {
    setStopping(true)
    setError(null)
    try {
      const response = await fetch(STOP_URL, { method: "POST" })
      const data = (await response.json().catch(() => ({}))) as StopResponse
      // 409 means the session already ended server-side (`session_restored`
      // — the admin's refresh rotation beat this click — or `target_gone`).
      // The record is closed and the marker cleared, so treat it as a
      // successful stop: clear the banner and reload instead of pinning a
      // stale error on a session that no longer exists.
      if (response.status === 409) {
        setFetched(null)
        if (onStopped) {
          onStopped()
        } else {
          window.location.reload()
        }
        return
      }
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not stop impersonation.")
        setStopping(false)
        return
      }
      // Adopt the restored admin session so the client's refresh timer is
      // re-armed to the admin token's expiry (not the impersonation's).
      if (data.session) acceptSession(data.session)
      // Clear immediately — don't wait for the next status poll or reload.
      setFetched(null)
      if (onStopped) {
        onStopped()
      } else {
        // Full reload: server components and the session provider must
        // re-resolve the restored admin session.
        window.location.reload()
      }
    } catch {
      setError("Could not stop impersonation. Check your connection.")
      setStopping(false)
    }
  }, [onStopped])

  const impersonation = selfFetching ? fetched : impersonationProp
  if (!impersonation) return null

  const expires = new Date(impersonation.expiresAt)
  const expiresLabel = Number.isNaN(expires.getTime())
    ? null
    : expires.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <span className="inline-flex items-center gap-2">
        <VenetianMask aria-hidden="true" className="size-4" />
        <span>
          Impersonating <strong>{impersonation.targetEmail}</strong>
          {impersonation.targetName ? ` (${impersonation.targetName})` : ""}
          {expiresLabel ? ` — session ends at ${expiresLabel}` : ""}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-amber-950/30 bg-transparent text-amber-950 hover:bg-amber-950/10"
        onClick={() => void stop()}
        disabled={stopping}
      >
        {stopping ? "Stopping…" : "Stop impersonating"}
      </Button>
      {error ? <span className="text-xs">{error}</span> : null}
    </div>
  )
}
