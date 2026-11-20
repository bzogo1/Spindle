"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCheck, ShieldAlert } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type {
  LoginAlert,
  LoginAlertKind,
  LoginAlertPreferences,
  LoginAlertSeverity,
} from "@/lib/auth/login-alerts"

/**
 * "Security alerts" panel for `/app/security`: lists the signed-in user's
 * suspicious-login alerts (new device/IP, sign-in velocity, brute force),
 * lets them mark alerts read, and toggles delivery preferences. All state
 * lives server-side behind `/api/auth/login-alerts`; this component only
 * fetches and posts.
 */

const LOGIN_ALERTS_API = "/api/auth/login-alerts"

const KIND_LABEL: Record<LoginAlertKind, string> = {
  new_device: "New device",
  new_ip: "New location",
  velocity: "Unusual activity",
  brute_force: "Failed attempts",
}

const SEVERITY_LABEL: Record<LoginAlertSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
}

const SEVERITY_BADGE_VARIANT: Record<LoginAlertSeverity, "secondary" | "outline" | "destructive"> =
  {
    info: "secondary",
    warning: "outline",
    critical: "destructive",
  }

interface LoginAlertsResponse {
  ok: boolean
  alerts?: LoginAlert[]
  unreadCount?: number
  preferences?: LoginAlertPreferences
  message?: string
}

function formatAlertTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function alertMeta(alert: LoginAlert): string {
  return [alert.ip, alert.userAgent, formatAlertTime(alert.createdAt)].filter(Boolean).join(" · ")
}

export function SecurityAlertsPanel() {
  const [alerts, setAlerts] = useState<LoginAlert[] | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [preferences, setPreferences] = useState<LoginAlertPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyResponse = useCallback((data: LoginAlertsResponse) => {
    if (!data.ok) {
      setError(data.message ?? "Could not update security alerts.")
      return false
    }
    setAlerts(data.alerts ?? [])
    setUnreadCount(data.unreadCount ?? 0)
    if (data.preferences) setPreferences(data.preferences)
    setError(null)
    return true
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(LOGIN_ALERTS_API, { cache: "no-store" })
      const data = (await response.json()) as LoginAlertsResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load security alerts.")
        setAlerts([])
        return
      }
      applyResponse(data)
    } catch {
      setError("Could not load security alerts. Check your connection and try again.")
      setAlerts([])
    } finally {
      setBusy(false)
    }
  }, [applyResponse])

  useEffect(() => {
    void load()
  }, [load])

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(LOGIN_ALERTS_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as LoginAlertsResponse
      if (!response.ok || !applyResponse(data)) {
        setError(data.message ?? "Could not update security alerts.")
        return false
      }
      return true
    } catch {
      setError("Could not update security alerts. Check your connection and try again.")
      return false
    } finally {
      setBusy(false)
    }
  }

  function markRead(alert: LoginAlert) {
    void post({ action: "mark_read", ids: [alert.id] })
  }

  function markAllRead() {
    void post({ action: "mark_all_read" })
  }

  function updatePreference(patch: Partial<LoginAlertPreferences>) {
    // Optimistic toggle; the POST response carries the authoritative prefs.
    // On failure the previous value is restored so the switch never shows a
    // preference the server did not persist.
    const previous = preferences
    setPreferences((current) => (current ? { ...current, ...patch } : current))
    void post({ action: "update_preferences", preferences: patch }).then((saved) => {
      if (!saved) setPreferences(previous)
    })
  }

  const loading = alerts === null && error === null

  return (
    <section className="app-panel" aria-labelledby="security-alerts-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="security-alerts-heading">Security alerts</h2>
          <p>
            Sign-ins from new devices or locations, unusual activity, and repeated failed attempts
            are flagged here.
            {unreadCount > 0 ? ` ${unreadCount} unread.` : ""}
          </p>
        </div>
        <div className="app-panel-head-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || unreadCount === 0}
            onClick={markAllRead}
          >
            <CheckCheck aria-hidden="true" />
            Mark all read
          </Button>
        </div>
      </div>

      {preferences ? (
        <div className="app-usage-meters" aria-label="Alert preferences">
          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <span className="app-usage-meter-label">In-app notifications</span>
              <Switch
                aria-label="In-app security alert notifications"
                checked={preferences.inAppNotifications}
                disabled={busy}
                onCheckedChange={(checked) => updatePreference({ inAppNotifications: checked })}
              />
            </div>
            <p className="app-field-hint">
              Show a notification in the app bell when a security alert is created.
            </p>
          </div>
          <div className="app-usage-meter">
            <div className="app-usage-meter-head">
              <span className="app-usage-meter-label">Email notifications</span>
              <Switch
                aria-label="Email security alert notifications"
                checked={preferences.emailNotifications}
                disabled={busy}
                onCheckedChange={(checked) => updatePreference({ emailNotifications: checked })}
              />
            </div>
            <p className="app-field-hint">
              Email you when a security alert is created. Stored now; delivery is wired up with the
              mailer.
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <InlineError
          title="Security alerts unavailable"
          message={error}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {loading ? (
        <p className="app-field-hint" role="status">
          Loading security alerts…
        </p>
      ) : alerts && alerts.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert aria-hidden="true" />}
          title="No security alerts"
          body="We will flag sign-ins from new devices, unusual activity, and repeated failed attempts here."
        />
      ) : (
        <ul className="grid gap-3" aria-label="Login alerts">
          {alerts?.map((alert) => (
            <li
              key={alert.id}
              className="app-panel-alt border-border rounded-lg border p-4"
              data-unread={alert.read ? "false" : "true"}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={SEVERITY_BADGE_VARIANT[alert.severity]} size="sm">
                      {SEVERITY_LABEL[alert.severity]}
                    </Badge>
                    <Badge variant="outline" size="sm">
                      {KIND_LABEL[alert.kind]}
                    </Badge>
                    {!alert.read ? (
                      <Badge variant="secondary" size="sm">
                        Unread
                      </Badge>
                    ) : null}
                  </div>
                  <strong className="text-sm">{alert.title}</strong>
                  <p className="text-muted-foreground text-sm leading-6">{alert.detail}</p>
                  <p className="text-muted-foreground text-xs">{alertMeta(alert)}</p>
                </div>
                {!alert.read ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => markRead(alert)}
                  >
                    Mark read
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
