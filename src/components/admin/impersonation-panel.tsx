"use client"

import { useCallback, useEffect, useState } from "react"
import { VenetianMask } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { acceptSession, type ClientSession } from "@/lib/auth/auth-client"
import {
  IMPERSONATION_STATUS_EVENT,
  type ImpersonationInfo,
} from "@/components/admin/impersonation-banner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Admin "Impersonation" panel for `/app/admin/impersonation`.
 *
 * Backed by:
 *  - GET  /api/auth/admin/impersonate/status
 *  - POST /api/auth/admin/impersonate/start  `{ email }`
 *  - POST /api/auth/admin/impersonate/stop   (via the AppShell banner)
 *
 * The fixed "Impersonating …" banner is rendered ONLY by `AppShell` — this
 * panel must not render a second one. After a successful start it dispatches
 * `IMPERSONATION_STATUS_EVENT` so the shell banner refetches and appears
 * immediately instead of waiting for its next poll.
 *
 * There is no user-list endpoint in the auth backend (`AuthBackend` has no
 * enumeration API), so targeting is by email — the same identifier
 * `/api/admin/users` rows expose. Targets that only exist in the Prisma user
 * directory cannot be impersonated until the auth backend can resolve them;
 * the API returns `target_not_found` in that case.
 *
 * IMPORTANT: after a successful start the browser's session IS the target
 * user. Do NOT call `router.refresh()` while impersonating — the `/app/admin`
 * layout guard would 404 the page. The panel keeps impersonation state
 * client-side; stopping restores the admin cookies and only then refreshes.
 */

const STATUS_URL = "/api/auth/admin/impersonate/status"
const START_URL = "/api/auth/admin/impersonate/start"

interface StatusResponse {
  ok: boolean
  active?: boolean
  impersonation?: ImpersonationInfo | null
  lastImpersonation?:
    (ImpersonationInfo & { adminEmail?: string; endReason?: string | null }) | null
  message?: string
  /** Session description returned by start/stop for client adoption. */
  session?: ClientSession | null
}

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready"
      impersonation: ImpersonationInfo | null
      lastImpersonation: StatusResponse["lastImpersonation"]
    }

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function ImpersonationPanel() {
  const [state, setState] = useState<PanelState>({ kind: "loading" })
  const [email, setEmail] = useState("")
  const [starting, setStarting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(STATUS_URL, { cache: "no-store" })
      const data = (await response.json()) as StatusResponse
      if (!response.ok || !data.ok) {
        setState({ kind: "error", message: data.message ?? "Could not load status." })
        return
      }
      setState({
        kind: "ready",
        impersonation: data.active ? (data.impersonation ?? null) : null,
        lastImpersonation: data.lastImpersonation ?? null,
      })
    } catch {
      setState({
        kind: "error",
        message: "Could not load impersonation status. Check your connection.",
      })
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const start = useCallback(async () => {
    const target = email.trim()
    if (!target || starting) return
    setStarting(true)
    setActionError(null)
    try {
      const response = await fetch(START_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
      })
      const data = (await response.json()) as StatusResponse
      if (!response.ok || !data.ok) {
        setActionError(data.message ?? "Could not start impersonation.")
        setStarting(false)
        return
      }
      // The session cookies now belong to the target user. Adopt the
      // impersonated session client-side so the auth client's refresh timer
      // is re-armed to the IMPERSONATION token's expiry — otherwise the
      // timer armed for the admin session would fire mid-impersonation and
      // rotate the admin refresh token, restoring the admin session early.
      // Keep everything else client-side: a server refresh would hit the
      // admin layout guard.
      if (data.session) acceptSession(data.session)
      // The shell banner owns stop/status display; nudge it to refetch now.
      window.dispatchEvent(new Event(IMPERSONATION_STATUS_EVENT))
      setState({
        kind: "ready",
        impersonation: data.impersonation ?? {
          id: "",
          targetEmail: target,
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
        lastImpersonation: null,
      })
      setStarting(false)
    } catch {
      setActionError("Could not start impersonation. Check your connection.")
      setStarting(false)
    }
  }, [email, starting])

  if (state.kind === "loading") {
    return <LoadingPanel label="Loading impersonation status" className="min-h-48" />
  }
  if (state.kind === "error") {
    return (
      <InlineError
        message={state.message}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void loadStatus()}>
            Retry
          </Button>
        }
      />
    )
  }

  const { impersonation, lastImpersonation } = state

  return (
    <section className="app-panel" aria-labelledby="admin-impersonation-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="admin-impersonation-heading">Support impersonation</h2>
          <p>
            Impersonation sessions last 30 minutes, are audit-logged, and cannot target admin
            accounts. Your own session is restored when you stop.
          </p>
        </div>
        {impersonation ? <Badge variant="secondary">Active</Badge> : null}
      </div>

      {impersonation ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <VenetianMask aria-hidden="true" className="size-4" />
              Impersonating {impersonation.targetEmail}
            </CardTitle>
            <CardDescription>
              Started {formatDateTime(impersonation.startedAt)} · ends{" "}
              {formatDateTime(impersonation.expiresAt)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              You are seeing the app exactly as this user does — admin areas are unavailable while
              impersonating. Use the Stop button in the banner at the top of the page to return to
              your admin session before the session expires.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start an impersonation</CardTitle>
            <CardDescription>
              Enter the email of the user you need to reproduce an issue for.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault()
                void start()
              }}
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="impersonation-email">User email</Label>
                <Input
                  id="impersonation-email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={starting}
                />
              </div>
              <Button type="submit" disabled={starting || !email.trim()}>
                {starting ? "Starting…" : "Impersonate"}
              </Button>
            </form>
            {actionError ? (
              <p className="text-destructive mt-3 text-sm" role="alert">
                {actionError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {lastImpersonation ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent impersonation</CardTitle>
            <CardDescription>
              {lastImpersonation.targetEmail}
              {lastImpersonation.endedAt
                ? ` — ended ${formatDateTime(lastImpersonation.endedAt)} (${lastImpersonation.endReason ?? "unknown"})`
                : ""}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </section>
  )
}
